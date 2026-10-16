# App Host

When an [agent-hosted plugin](agent-hosted-plugins.md)'s manifest names an agent package (`agent.package`), Lamaste installs the plugin's **agent half** onto the hosting agent itself: a system account, a hardened systemd unit with a socket unit that holds its port, its directories and the system packages it declares. Installing them needs root, and `lamaste-agent` runs as an unprivileged user — so it goes through one root program on the agent, **`lamaste-apphost`**, which the agent's user may run through one sudoers rule. This page is the agent machine's side: enabling the helper, what it creates, the unit and its socket, the relay-signed jobs it runs, and the contract an agent half is written to. The relay's side — hosting, approval, updates, removal — is in [Agent-Hosted Plugins](agent-hosted-plugins.md#hosting-with-an-agent-half). The design is `plugin-development/design/agent-hosted-app-plugins.md` (Slice 3).

It is a page of its own because it documents another machine and another trust boundary: a root program, its files and its unit on the agent, which the relay's API pages only refer to.

## In Plain English

The operator of an agent machine says once: _the panel may install plugins here_ (`sudo lamaste-agent apphost enable`). From then on, hosting a plugin from the panel installs its agent half on that machine with nothing done by hand: the agent's sync timer downloads exactly the package version the relay pinned, checks it byte for byte, and hands it to the helper, which unpacks it read-only under `/opt`, gives it an account of its own and a data directory under `/var/lib`, and starts it as a locked-down service on a port systemd holds for it. Plugin code never runs as root.

The helper does only what the relay **signed**. When it is enabled it remembers (pins) the relay's public key; every install, version switch and removal the relay asks for carries the relay's signature over exactly that job, and the helper refuses anything else — so a compromised agent account cannot make it install, switch or delete anything the relay did not ask for.

## Enabling the helper

Once per agent machine (Linux with systemd; macOS agents cannot host an agent half Lamaste installs):

```bash
sudo npm install -g @lamalibre/lamaste-agent   # a root-owned install
sudo lamaste-agent apphost enable              # the agent runs as the user who ran sudo
sudo lamaste-agent apphost enable --user root  # the agent runs as root: no sudoers rule
```

`enable` refuses to act from an install another user could have changed: the package, the helper it ships and the core library it loads — and every directory above them — must be root-owned and writable by no group or other user. A user-level install (`nvm`, a home-directory prefix) is not; install it root-owned with `sudo npm install -g @lamalibre/lamaste-agent` and run `enable` from that install. It also needs `/usr/bin/node` (the helper's interpreter and the Node.js every agent half runs on — from the distribution or NodeSource), systemd as the system manager (`/run/systemd/system`), and `sudo` and `visudo` unless the agent runs as root.

What `enable` does:

1. Installs the helper root:root 0755 at `/usr/local/sbin/lamaste-apphost` (written under a hidden temporary name, renamed into place).
2. Writes `/etc/sudoers.d/lamaste-apphost` (root:root 0440) naming the agent's user — the one who ran `sudo`, or `--user`. The file is checked with `visudo -c` before it is renamed into place; an invalid rule is never live. With `--user root` no rule is written and an existing one is removed. **App hosting serves one OS user per machine**: while the rule names another user, `enable` is refused — that user's agents could no longer install, update or remove their agent halves, which would stay on the machine with nobody to manage them. Unhost or uninstall the plugins those agents host first (`apphost status` lists the agent halves installed), then `--force` replaces the rule (or removes it, for `--user root`).
3. Checks that the helper answers (`status`) and that the agent's user can run it with `sudo -n`.
4. Pins the relay key of every agent of that user on the machine (see [Pinning the relay key](#pinning-the-relay-key)), printing each label's key id to compare with the relay's. A failure here leaves the helper enabled — it runs no job until `sudo lamaste-agent apphost pin` succeeds.

The agent's next sync reports the helper to the relay in its [host facts](agent-hosted-plugins.md#host-facts); from then on the panel lists the agent as able to host plugins whose agent half Lamaste installs.

### The sudoers rule

```
Defaults!/usr/local/sbin/lamaste-apphost env_reset
Defaults!/usr/local/sbin/lamaste-apphost !setenv
Defaults!/usr/local/sbin/lamaste-apphost env_keep -= "NODE_OPTIONS NODE_PATH NODE_EXTRA_CA_CERTS NODE_ICU_DATA NODE_REPL_EXTERNAL_MODULE NODE_REDIRECT_WARNINGS NODE_V8_COVERAGE NODE_COMPILE_CACHE NODE_PRESERVE_SYMLINKS NODE_DEBUG NODE_DEBUG_NATIVE NODE_TLS_REJECT_UNAUTHORIZED"
Defaults!/usr/local/sbin/lamaste-apphost env_delete += "NODE_OPTIONS NODE_PATH …the same list…"
<user> ALL=(root) NOPASSWD: /usr/local/sbin/lamaste-apphost
```

Any arguments are allowed: the helper validates every argument and derives every path itself. The environment is reset, and the Node.js variables that load code, change module resolution or write files can never reach it, whatever else sudoers says.

### `lamaste-agent apphost`

| Command                                                                 | Run as                   | Does                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sudo lamaste-agent apphost enable [--user <name>] [--force]`           | root                     | Install the helper and the rule, pin each agent's relay key (above). Refused while the rule names another user, unless `--force`                                                                                                                                                  |
| `sudo lamaste-agent apphost pin [--label <label>] [--user <name>]`      | root                     | Pin the relay key again — after a relay rotated its key, or an agent was enrolled again. The user defaults to the one the rule names, else root. Prints each label's key id and the one pinned before (`was …`); exits 1 when a label failed                                      |
| `lamaste-agent apphost status [--json]`                                 | the agent's user or root | The helper (protocol, Node.js, whether it is the version this install ships), the pinned relay keys, the agent halves installed (version, previous version, unit state, owner). As root also the user the rule names                                                              |
| `lamaste-agent apphost relay-keys [--label <label>] [--json]`           | the agent's user         | What each agent's relay publishes now, fetched over the agent's pinned mTLS channel, and whether it is the key pinned                                                                                                                                                             |
| `sudo lamaste-agent apphost remove <route> [--purge] [--label <label>]` | root                     | Remove an agent half as the operator, with no relay involved — for an agent its relay can no longer reach. Keeps its data unless `--purge`. Acts as the agent the owner record names; `--label` names it when there is no record. Unhost or uninstall the plugin on the relay too |
| `sudo lamaste-agent apphost disable [--force]`                          | root                     | Remove the rule (first), the helper and the pinned keys. Refused while agent halves are installed; `--force` removes them first, keeping their data                                                                                                                               |

All are Linux only. `enable`, `pin`, `remove` and `disable` refuse to run from an install that is not root-owned, as `enable` does.

## The helper

`/usr/local/sbin/lamaste-apphost` is a self-contained CommonJS script (Node.js built-ins only, `#!/usr/bin/node`) that reads nothing the agent's user can write. Every name and path derives from validated arguments; content — a tarball, a service spec, a plugin config, a signature — arrives on stdin, so neither a tarball nor a secret is in the sudo log, and nothing read from stdin is ever echoed. One mutating command runs at a time (`/run/lamaste-apphost.lock`, holding the owner's PID; a lock whose process is gone is taken over).

| Command                                         | stdin                                                                                          | Signed | Does                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install <label> <route> <version> <integrity>` | the signature (one line of JSON), the service spec (one line of JSON), then the package `.tgz` | yes    | Install that version of the agent half and make it current                                                                                                                                                                                                                                           |
| `config <label> <route>`                        | the plugin config (JSON)                                                                       | no     | Write the service's copy of the plugin config; write the [socket unit](#the-socket-unit) for its port, start the socket and the unit. A new port moves the socket (the unit restarts on it); a rotated secret changes nothing else and restarts nothing. Exit 3 when the agent half is not installed |
| `activate <label> <route> <version>`            | the signature                                                                                  | yes    | Point `current` at a kept version, restore that version's unit, restart                                                                                                                                                                                                                              |
| `remove <label> <route> [--purge]`              | the signature                                                                                  | yes    | Stop and disable the unit and its socket; remove both unit files (and the unit's drop-in directory), code and config. `--purge` also deletes the data directory, the account and the owner record                                                                                                    |
| `status [<route>]`                              | —                                                                                              | no     | `{ protocol, node, apps: { <route>: { versions, current, previous, unit, socket, owner } } }` — `node` is the Node.js the helper, and so every agent half, runs on; `socket` the socket unit's state (`active`, `inactive`, `absent` until the config is there)                                      |

`<label>` is the agent's label on this machine. `config` and `status` are not signed: the agent's user holds the plugin config already, and `status` changes nothing. An operator's `sudo lamaste-agent apphost remove|disable` loads the helper into its own root process and calls its removal directly — operator authority comes only from code already running as root, never from the helper's command line.

The mutating commands print `{ "ok": true, "version": "1.2.0", "unit": "active" }` (`version`: what `current` points at, `null` after `remove`; `unit`: the service's state, `active`, `inactive` or `absent`). Errors are one line on stderr, `lamaste-apphost: …`.

| Exit | Meaning                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Done                                                                                                                                                                |
| 1    | Failed                                                                                                                                                              |
| 2    | Refused: bad arguments or input                                                                                                                                     |
| 3    | That agent half is not installed (`config`, `activate`)                                                                                                             |
| 4    | The route belongs to another agent or another package                                                                                                               |
| 5    | Refused: not a job the relay signed for this agent and command — no signature, no pinned key, another key, a bad, expired or reused one, or one for other arguments |

### What `install` checks

In this order; nothing of the agent half is written before they pass:

1. The arguments: the route (`^[a-z0-9]([a-z0-9-]{0,98}[a-z0-9])?$`), the label, a semver version without build metadata, a SHA-512 SRI integrity.
2. The relay's signature on the first line (see [Signed app jobs](#signed-app-jobs)): an `app-install` job for this agent and route whose spec — package, version, integrity, service, system packages — is exactly the arguments and the spec line.
3. The tarball's SHA-512 against the integrity; then the archive itself, unpacked in memory: POSIX ustar as npm writes it, valid checksums, only regular files and directories, every path inside `package/` with no `.`, `..` or empty segment, each at most once, nothing after the end marker. Links, devices, FIFOs and GNU or global PAX extensions are refused.
4. systemd is the system manager.
5. The job id has not run before — it is recorded now, so the job is spent whatever follows.
6. **Ownership.** The route's owner record names this label and this package; a route with data or code on the machine but no owner record is not taken over.
7. At most 50 agent halves per machine; enough free space in `/opt/lamalibre/apps` for the unpacked package, 4 KiB per entry and a 64 MiB margin.
8. **The bundled rule**, on the unpacked tree: `package.json` names the spec's package at the version; no non-empty `dependencies` or `optionalDependencies`, no `bundleDependencies`; no `preinstall`, `install` or `postinstall` script; no `binding.gyp`; the service entry is a file in the package. Every file becomes root-owned 0644, every directory 0755 — no executable or set-id bit, nothing the agent half can change.

Then: the approved system packages it lacks are installed (`apt-get install -y --no-install-recommends`, Debian and Ubuntu only), the account, the owner record, the data and config directories are created, the version is moved into place, the unit is written, `current` switched, systemd reloaded and the unit (re)started — once its plugin config is there, with the socket unit that holds its port (see [The socket unit](#the-socket-unit)). A failure before the version is in place takes back what this run created; a failure after it restores the version that ran before, or for a first install removes everything. The current and previous versions are kept; older ones are deleted.

### What it creates

| Path or name                                        | Owner, mode                      | What                                                                                                                                  |
| --------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `lamaste-app-<route>` (user and group)              | system account                   | The agent half's account: `--system`, no home (`/nonexistent`), shell `/usr/sbin/nologin`, comment `lamaste-app route=<route>`        |
| `/opt/lamalibre/apps/<route>/<version>/`            | root, dirs 0755, files 0644      | The package (`package/`) and `apphost.json`, the spec it was installed with (restored on `activate`)                                  |
| `/opt/lamalibre/apps/<route>/current`, `previous`   | root (symlinks)                  | The running version and the one before it                                                                                             |
| `/var/lib/lamalibre/apps/<route>/`                  | the account, 0700                | The agent half's data — kept across versions and on removal, deleted only by a purge                                                  |
| `/etc/lamalibre/apps/<route>/`                      | root:\<account's group\>, 0750   | The agent half's configuration directory                                                                                              |
| `/etc/lamalibre/apps/<route>/plugin-config.json`    | the account, 0600                | Port and installation secret (`LAMASTE_APP_CONFIG`)                                                                                   |
| `/etc/systemd/system/lamalibre-app-<route>.service` | root, 0644                       | The unit (below)                                                                                                                      |
| `/etc/systemd/system/lamalibre-app-<route>.socket`  | root, 0644                       | The socket unit holding the agent half's port (below) — written once its plugin config is there                                       |
| `/var/lib/lamalibre/apps/.owners/<route>.json`      | root 0644, directory root 0755   | The owner record: `{ route, package, label, since }` — outside the data the agent half can write. Kept on removal, deleted by a purge |
| `/var/lib/lamalibre/apps/.jobs/used.json`           | root 0600, directory root 0700   | The ids of the signed jobs that ran, each kept until its signature expires                                                            |
| `/var/lib/lamalibre/apps/.trash/`                   | root, 0700                       | A purged data directory is moved here, out of its account's reach, and deleted                                                        |
| `/etc/lamalibre/apphost/relays/<label>.json`        | root 0644, directories root 0755 | The relay key pinned for agent `<label>`                                                                                              |
| `/opt/lamalibre/apps/.stage-<hex>-<route>/`         | root, 0700                       | Unpacking, while an install runs                                                                                                      |

A route never starts with `.`, so the dot-directories cannot collide with a data directory.

**Account names.** `lamaste-app-<route>` while that is at most 30 characters (routes of up to 18 characters) — readable in `ps`, the journal and file listings. A longer route gets `lamaste-app-<first 2 characters>-<16 hex digits of SHA-256(route)>`, always exactly 31 characters (systemd's limit for `User=`): `samplepark-management` runs as `lamaste-app-sa-3e26a99e45bb5463`. The lengths keep the two forms apart, and 64 bits of hash make crafting a route whose name equals another's a 2^64 search. The account's comment names its route; an account of the same name whose comment names another route — or none — is never reused, given files or deleted (exit 4), and neither is a group of that name without the account. An account with uid or gid 0 is refused.

## The unit

For plugin `market-indicators`, with `memoryMax: "256M"`:

```ini
# Managed by lamaste-apphost: the agent half of Lamaste app plugin market-indicators.
# It listens on the socket systemd holds for it (lamalibre-app-market-indicators.socket), passed as descriptor 3.
[Unit]
Description=Lamaste app plugin market-indicators (agent half)
Requires=lamalibre-app-market-indicators.socket
After=lamalibre-app-market-indicators.socket
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Sockets=lamalibre-app-market-indicators.socket
User=lamaste-app-market-indicators
Group=lamaste-app-market-indicators
ExecStart=/usr/bin/node /opt/lamalibre/apps/market-indicators/current/package/dist/agentd.mjs
Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/market-indicators/plugin-config.json
Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/market-indicators
Environment=NODE_ENV=production
WorkingDirectory=/var/lib/lamalibre/apps/market-indicators
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/lamalibre/apps/market-indicators
ReadOnlyPaths=/run
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
TemporaryFileSystem=/dev/shm:nosuid,nodev,noexec
PrivateIPC=yes
RemoveIPC=yes
ProtectProc=invisible
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
CapabilityBoundingSet=
UMask=0077
LimitCORE=0
MemoryMax=256M
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

The unit is written from a fixed template; it holds paths, never a secret — and no port: that is in its [socket unit](#the-socket-unit), written once the plugin config is there.

| Directive                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User=` / `Group=` the agent half's account                                                                                     | Plugin code never runs as root or as the agent's user                                                                                                                                                                                                                                                                                                                                |
| `Requires=`, `After=`, `Sockets=` its socket unit                                                                               | The socket listens before the agent half starts, and systemd passes it on every start — at boot, on `start` or `restart`, after a crash, or on a connection while it was stopped — as descriptor 3 (`LISTEN_PID`, `LISTEN_FDS`). Stopping or restarting the socket stops or restarts the agent half                                                                                  |
| `NoNewPrivileges`, `CapabilityBoundingSet=` (empty), `RestrictSUIDSGID`                                                         | No privilege gained through set-id binaries or capabilities; no privileged port, no `chown`                                                                                                                                                                                                                                                                                          |
| `ProtectSystem=strict`, `ReadWritePaths=` the data directory, `ReadOnlyPaths=/run`, `ProtectHome`, `PrivateTmp`, `UMask=0077`   | The whole file system read-only but the data directory and a private `/tmp`; `/run` too (strict leaves it writable, and `/run/lock` is world-writable); homes invisible; new files private                                                                                                                                                                                           |
| `PrivateDevices`, `TemporaryFileSystem=/dev/shm`, `PrivateIPC`, `RemoveIPC`                                                     | No device nodes, an empty `/dev/shm` it cannot write (PrivateDevices alone binds the machine's, which every user can write; a bundled Node agent half has no use for POSIX shared memory), no shared IPC namespace, its IPC objects removed when it stops                                                                                                                            |
| `ProtectProc=invisible`                                                                                                         | Other users' processes are not visible in `/proc`                                                                                                                                                                                                                                                                                                                                    |
| `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectKernelLogs`, `ProtectControlGroups`, `ProtectClock`, `ProtectHostname` | The kernel's tunables and modules, the cgroup tree, the clock and the hostname cannot be changed; the kernel log cannot be read                                                                                                                                                                                                                                                      |
| `RestrictRealtime`, `RestrictNamespaces`, `LockPersonality`, `SystemCallArchitectures=native`                                   | No realtime scheduling, no new namespaces, no personality or foreign-ABI tricks                                                                                                                                                                                                                                                                                                      |
| `SystemCallFilter=@system-service`, `SystemCallErrorNumber=EPERM`                                                               | Only the system calls services need; a call outside the set fails with `EPERM` instead of killing the process (libuv probes `io_uring` and falls back to its thread pool)                                                                                                                                                                                                            |
| `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`                                                                              | IP and Unix sockets only. Outbound network stays the application's (an agent half fetches what it must); it listens on loopback                                                                                                                                                                                                                                                      |
| `LimitCORE=0`                                                                                                                   | No core dump of a process that holds the installation secret; the hard limit too, so the agent half cannot raise it                                                                                                                                                                                                                                                                  |
| `MemoryMax=`                                                                                                                    | From `agent.service.memoryMax`; left out when the manifest sets none                                                                                                                                                                                                                                                                                                                 |
| `Restart=always`, `WantedBy=multi-user.target`                                                                                  | Restarted 5 s after it exits, whatever its exit status; started at boot. A stopped service whose socket still listens would be started by every connection, and five starts within ten seconds trip systemd's start limit — which fails the socket and lets go of the port; restarted on its own, it is never left stopped for a connection to start. Only `systemctl stop` stops it |

Not used, on purpose:

- **`MemoryDenyWriteExecute`** — V8's JIT writes the machine code it runs, which the setting forbids.
- **`ProcSubset=pid`** — Node.js reads `/proc/cpuinfo`, `/proc/stat` and `/proc/meminfo` for `os.cpus()`, `os.totalmem()` and `os.freemem()`, which applications use to size worker pools; hiding them breaks them quietly.
- **`AF_NETLINK`** is not among the address families, so `os.networkInterfaces()` fails. An agent half listens on `127.0.0.1` and needs no interface list.
- **`IPAddressDeny`** — the application's own outbound calls are its business (market data, a mail relay).
- **`SocketBindAllow=` / `SocketBindDeny=`** — systemd enforces them only when built with its BPF framework, which the systemd of Ubuntu 22.04 and 24.04 and of Debian 12 is not (they are ignored there, silently), and where they are enforced they deny all UDP from Node.js (`dgram` binds port 0 before its first send). The socket unit keeps the port for the agent half on every distribution instead, and its UDP works.

The journal has the agent half's output: `journalctl -u lamalibre-app-<route>`.

### The socket unit

The agent half never binds its port: systemd does, in a socket unit beside the unit, and passes it the listening socket. For plugin `market-indicators` on port 21007:

```ini
# Managed by lamaste-apphost: the port of the agent half of Lamaste app plugin market-indicators.
[Unit]
Description=Lamaste app plugin market-indicators (agent half socket)

[Socket]
ListenStream=127.0.0.1:21007
Accept=no
NoDelay=true
Service=lamalibre-app-market-indicators.service

[Install]
WantedBy=sockets.target
```

`Accept=no`: one listening socket for one long-running process, not a process per connection. `NoDelay=true` sets `TCP_NODELAY`, as Node.js's own HTTP server does. No `ReusePort=`, so nobody else may bind the port beside it. `sockets.target` wants it, so it listens from early boot; the agent half is still started at boot by `multi-user.target`, not on its first connection.

**Why.** While systemd holds the socket the port stays bound — while the agent half restarts, is updated, crashes or is stopped — so no other local process (another agent half, the agent's user, any account on the machine) can take it in between: there is no window to squat it and answer in its place, nor to hold it and keep the agent half from starting. It works the same on every distribution with systemd, and leaves the agent half's own UDP untouched. (What reaches the port is authenticated as well — see [Security Model](../01-concepts/security-model.md#5d-the-app-host-on-agents).)

**When it is written.** Root-owned 0644, atomically, from the validated plugin config — so not by `install` when the config has not arrived yet: the socket and the unit are first started together by the `config` that brings it (or by an `install` or `activate` once it is there). After that:

- **The same port** (a rotated secret, an update, an activation): the file is left as it is and the socket keeps listening; the unit restarts on it (an update or activation) or not at all (a rotation).
- **Another port**: the socket moves. The unit is stopped, then the socket — the old port is let go — the file is written, systemd reloaded, the socket started on the new port, and only then the unit. The socket never listens while its file names another port: a daemon-reload would then close its descriptor and leave it active with nothing open. A run cut short leaves the socket stopped or its file not loaded, which the next start puts right. If another process holds the new port, the socket does not start and neither does the unit (`Requires=`), and the helper reports the failure.
- **The same port in another template** (a newer helper): written and loaded in place — systemd keeps a listening socket across a reload when its address is unchanged — so the port is never let go for it.

Enabling uses `systemctl enable --no-reload`; systemd is reloaded only when a unit file changed (also when systemd reports a unit file it has not loaded, `NeedDaemonReload`).

**On removal** both units are stopped and disabled and both files deleted — the port is released — along with any drop-in directory of the unit (`lamalibre-app-<route>.service.d/`, an operator's overrides), followed by one daemon-reload. A route installed later inherits none of them.

## Signed app jobs

The helper runs as root on the agent's behalf, so whatever the agent's user could hand it — a service spec naming system packages, a version to activate, a purge — it would otherwise do as root. Approval of what an agent half brings happens on the relay ([approval](lifecycle-hooks.md#approval)); the relay therefore **signs** every app job when it creates it, and the helper refuses anything it did not sign. The agent carries the signature from `agent-config` to the helper and can neither make nor change one.

The relay signs with its Ed25519 relay key — the key it already signs [relay assertions](../01-concepts/security-model.md#5c-the-agent-daemon-lamaste-agentd-and-relay-assertions) with (`/etc/lamalibre/lamaste/relay-signing-key.json`). The signed bytes are the canonical JSON (keys sorted at every level, no whitespace) of the envelope:

```json
{
  "v": 1,
  "typ": "lamaste.apphost.job",
  "kid": "…32 hex: the relay key's id…",
  "agent": "vm1",
  "route": "market-indicators",
  "jobId": "…uuid…",
  "kind": "app-install",
  "payload": {
    "spec": {
      "package": "@lamalibre/market-indicators-agent",
      "version": "1.2.0",
      "integrity": "sha512-…",
      "service": { "entry": "dist/agentd.mjs", "memoryMax": "256M" },
      "systemPackages": ["sqlite3"]
    }
  },
  "issuedAt": "2026-10-16T10:00:00.000Z",
  "expiresAt": "2026-10-16T10:11:30.000Z"
}
```

| Kind           | Payload                | Helper command                                                                           |
| -------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| `app-install`  | `{ spec }`             | `install` — the spec, version and integrity must equal its arguments and stdin           |
| `app-activate` | `{ version, package }` | `activate` — the version must equal its argument; the route's owner must be that package |
| `app-remove`   | `{ purge, package }`   | `remove` — the purge flag must equal `--purge`; the route's owner must be that package   |

`agent` is the label the relay knows the agent by; `expiresAt` is the job's deadline (its timeout plus 90 s of delivery). The signature travels as `{ "envelope": base64url(canonical JSON), "sig": base64url(Ed25519 signature) }`, listed with the job in `agent-config`. A relay assertion signs the base64url text of its payload while an app job signs JSON bytes, which start with `{` — never a base64url character — so neither can be taken for the other.

The helper verifies, with Node.js built-ins only (it trusts no code the agent's user can change):

- the line is exactly `{ envelope, sig }`, both canonical base64url, and the envelope is canonical JSON — what was signed is exactly what is read;
- every envelope field and no other; a validity of at most one hour;
- the key id is the one pinned for `<label>`, and the signature verifies with it;
- `agent` is the relay's label for this agent (from the pin), `route` and `kind` are the command's;
- `issuedAt` is not more than 5 s ahead of the machine's clock, `expiresAt` has not passed;
- the payload is what the command was asked;
- the job id has not run before: ids are kept in `/var/lib/lamalibre/apps/.jobs/used.json` until they expire, so a job runs once (at most 10 000 within the hour).

Any failure is exit 5, with a message that says what to do — `re-pin the relay key: sudo lamaste-agent apphost pin` for a key the relay rotated or an agent enrolled again, `check the clocks of agent and relay` for a signature from the future.

### Pinning the relay key

`sudo lamaste-agent apphost enable` and `sudo lamaste-agent apphost pin` fetch each agent's relay key **as the agent's user** (`sudo -n -u <user> -H -- … lamaste-agent apphost relay-keys --json`), over that agent's own pinned mTLS channel (`GET /api/agents/me/relay-keys`) — root never handles the agent's certificate or its password. An agent without a pinned panel certificate is not pinned: its channel could be anyone's. Root accepts the answer only as it validates it — a label of that user's agents, an `https` panel URL, an Ed25519 key whose id is derived from the key (the first 16 bytes of the SHA-256 of its DER SubjectPublicKeyInfo, hex), the relay's label for the agent — and writes the first key, the one the relay signs with:

```json
{
  "v": 1,
  "label": "vm1",
  "agent": "vm1",
  "kid": "…32 hex…",
  "publicKey": "…base64 DER SPKI…",
  "panelUrl": "https://203.0.113.42:9292",
  "pinnedAt": "2026-10-16T10:00:00.000Z"
}
```

The helper reads a pin only from a root-owned file (opened without following links) in root-owned directories nobody else may write.

**Whose labels.** Root checks each label against the agent user's own agent registry, which it reads itself: `~/.lamalibre/lamaste/agents.json` in that user's home as the user database names it (`getent passwd` — the home `sudo -H` gives the CLI that fetched the keys), only as a regular file that user owns, not through a link and at most 1 MiB. A label the registry does not list is not pinned. A pin is per label for the whole machine and the helper serves root as well as the rule's user, so for any user but root a label root's own agents use is refused too (`pin it with --user root`) — one user's answer never replaces the key another's agent verifies its jobs with. The registry is that user's file: the check keeps its pins to the agents it set up, and away from root's; it does not make its answer more trustworthy than its account (below).

**Trust on first use.** The pin is as trustworthy as the agent's account and its channel at the moment `enable` or `pin` runs. Compare it with the relay's key once:

- on the relay: the panel logs the key id at start-up (`journalctl -u lamalibre-lamaste-serverd | grep 'signing key ready'`), and `GET /api/agents/me/relay-keys` with the admin certificate answers `keys[0].kid`;
- on the agent: `enable` and `pin` print each label's pinned id in full, and for a re-pin the id pinned before (`was …`); `sudo lamaste-agent apphost status` lists them; `lamaste-agent apphost relay-keys` shows what the relay publishes now and whether it is pinned;
- in the panel: the Certificates page and the host dialog show the first 12 hex digits of the id each agent reports pinned, and an agent whose pin is not the relay's key is not eligible (`re-pin the relay key`).

**Rotation.** After the relay's signing key is replaced, every agent's helper refuses that relay's jobs until `sudo lamaste-agent apphost pin` runs on the agent; the panel shows those agents as not eligible meanwhile. An agent enrolled again under another relay label needs a re-pin too.

## On the agent: how a job arrives

The relay lists app jobs in `GET /api/tunnels/agent-config` (`agentJobs`, see [Agent-Hosted Plugins](agent-hosted-plugins.md#what-the-agent-does-with-it)). The agent's sync timer runs them one after another after converge, outside the agent lock:

- **A job is checked first.** An app job without a signature, with a malformed one, or whose signature does not describe exactly that job (id, route, kind, deadline, payload) is never run and is reported failed.
- **`app-install`** waits for the next sync until the plugin config has arrived (the relay issues it before it lists the job). Then the agent checks the helper — enabled, answering, protocol ≥ 1, the route not another agent's — fetches a registry token from the panel (`GET /api/agents/me/registry-credential`), runs `npm pack <package>@<version> --ignore-scripts` into a fresh 0700 directory under `~/.lamalibre/lamaste/tmp/agent/` with that token in a throw-away userconfig, refuses a tarball over 128 MiB or one whose SHA-512 is not the pinned integrity, and pipes signature, spec and tarball to `lamaste-apphost install`. Under the agent lock it then records the route in `apphost-state.json` and hands the service its plugin config (`lamaste-apphost config`).
- **`app-activate`** and **`app-remove`** hand the signature to `activate` / `remove`. Removing with the helper disabled succeeds (`disable` removed every agent half first) unless it is a purge.
- **Failures are reported, never undone here.** The agent cannot sign, so it never removes or switches an agent half on its own: the relay, which recovers from every install it dispatched, sends the signed removal or activation. A result is kept in `app-job-results.json` until the relay took it — the helper runs a signed job once, so a report that failed is made again on the next sync without running the job again.
- **Plugin configs.** For a route recorded in `apphost-state.json`, converge hands a fetched config to the service (`lamaste-apphost config`) **before** acknowledging it, so the relay never signs with a secret the service does not hold; a rotation therefore needs no restart. When the record cannot be read nothing is delivered or acknowledged until the sync rebuilds it from the helper's owner records.

`sync.log` records `app install ran: <route>`, `app install refused (not signed by the relay): <route>` and `plugin config delivered to its service: <route>`. The sync unit allows one run 20 minutes (`TimeoutStartSec=20min`): an install may take its full 10 minutes.

## Several agents on one machine

Agents of different relays may share a machine and its helper — under the one user the rule names, or root (`enable` for another user is refused unless `--force`). Each label has its own pin, and each relay's jobs name its own agent. A route belongs to the agent that first installed it (its owner record); another agent, or another package, is refused that route — and the data kept with it — until the owner purges it (exit 4). The sync also leaves a route alone that another agent's `apphost-state.json` lists, and delivers no config while two agents claim one.

## Writing an agent half

The manifest names the agent package and how it runs (see [the manifest](agent-hosted-plugins.md#the-manifest)):

```json
"agent": {
  "requires": { "node": ">=22", "os": ["linux"], "systemPackages": ["sqlite3"] },
  "package": "@lamalibre/market-indicators-agent",
  "service": { "entry": "dist/agentd.mjs", "memoryMax": "256M" }
}
```

The contract:

- **One bundled package.** An `@lamalibre/` package published at the plugin's version, whose registry entry carries a SHA-512 integrity. Bundle everything into it (esbuild): no runtime `dependencies` or `optionalDependencies`, no `bundleDependencies`, no `preinstall`/`install`/`postinstall` script, no native addon (`binding.gyp`). The tarball the relay pins is then the whole code that runs; nothing is compiled or fetched as root.
- **The entry** is a relative `.js`, `.mjs` or `.cjs` path in the package, run as `/usr/bin/node <entry>` — the Node.js of the helper, which `agent.requires.node` is checked against.
- **Files are read-only.** Every file is installed root-owned 0644 — no executable bit, so the agent half spawns no program of its own package directly; directories 0755.
- **It writes only its data directory**, `LAMASTE_APP_DATA_DIR` (also its working directory, 0700), and its private `/tmp`. Use `node:sqlite` for a database.
- **Its config** is `LAMASTE_APP_CONFIG` (0600): `{ plugin, port, secret, issuedAt, previousSecret?, previousIssuedAt?, fetchedAt, acknowledged }`. Verify every `/admin/*` request with it.
- **Listen on the socket systemd passes — never bind a port yourself.** `agentHalfListenTarget()` answers `{ fd: 3, host: '127.0.0.1' }` under the helper's unit; systemd holds the port, so binding it fails with `EADDRINUSE`. Give it the config's port so the same code also runs as an agent half installed by hand (no socket: it answers `{ host: '127.0.0.1', port }`):

  ```js
  import Fastify from 'fastify';
  import { agentHalfListenTarget, createCallerAssertionVerifier } from '@lamalibre/lamaste/agent'; // bundled

  const verifier = createCallerAssertionVerifier({
    configPath: process.env.LAMASTE_APP_CONFIG,
    plugin: 'market-indicators',
  });
  const target = agentHalfListenTarget({ port: await verifier.port() });

  const app = Fastify();
  // …routes
  await app.listen(target); // or, with node:http: http.createServer(handler).listen(target)
  ```

  Pass the target to Fastify as it is: with `fd`, its `host` keeps Fastify from opening a second server on the descriptor for `::1` (its default host is `localhost`). Call it once, at start-up: it reads systemd's `LISTEN_PID`, `LISTEN_FDS` and `LISTEN_FDNAMES` and removes them from `process.env`, so no process the agent half starts takes the socket for its own. Any number of sockets but one is refused. The verifier re-reads the config when a signature does not verify, so a rotated secret needs no restart; a changed port moves the socket and restarts the unit on it.

- **Lifecycle hooks** are answered at `POST /admin/hooks/<stage>` ([agent hooks](lifecycle-hooks.md#agent-hooks)); the agent's own `install:pre-tunnel` reaches the service on its loopback once it runs.
- **Settings**, when the manifest declares them, are kept with `createSettingsStore` over `LAMASTE_APP_DATA_DIR` — `settings.json` and `secrets.json`, 0600 — and answered at `/admin/settings` with `createSettingsHandler` ([Settings](agent-hosted-plugins.md#in-the-agent-half)); they stay with the retained data and a purge deletes them.
- **Limits of the sandbox:** no capabilities (no port below 1024), IP and Unix sockets only, no `os.networkInterfaces()`, only its own processes in `/proc`, no core dumps. Its output goes to the journal; `NODE_ENV=production`.
- **System packages** (`agent.requires.systemPackages`) are installed with `apt-get` after approval, on Debian and Ubuntu only.
- **Name** the plugin by its route: a plugin with an agent half is named exactly its route (its packages keep their names), and the route starts and ends with a letter or digit.

## Retained data

Removing an agent half without purge — unhosting, uninstalling, a rolled-back install — keeps its data directory, its account and its owner record on the agent. The relay keeps a record of it, by the plugin's name, so it can still be purged after the plugin is uninstalled: the Plugins page shows it under **Retained data** on the plugin's card, or — once the plugin is uninstalled — under **Retained data of uninstalled plugins**; `lamaste-server plugins retained-data [<name>]` lists it ([the API](agent-hosted-plugins.md#retained-data)). Hosting the same agent package on that agent again takes the data back; another package is refused (`retained_data_conflict`) until it is purged:

- from the relay — **Purge** on the Plugins page, or `lamaste-server plugins purge-data <name> --agent <label>` — an `app-remove` job with purge, gated by push install like any removal and followed like any operation;
- on the machine — for an agent the relay can no longer reach — `sudo lamaste-agent apphost remove <route> --purge`, then **Forget** on the Plugins page or `lamaste-server plugins forget-data <name> --agent <label>` to drop the relay's record. Forgetting touches nothing on the agent.

## Limits

| What                                 | Limit                                                             |
| ------------------------------------ | ----------------------------------------------------------------- |
| Agent halves per machine             | 50                                                                |
| Package tarball                      | 128 MiB; 512 MiB unpacked; 50 000 entries; `package.json` 1 MiB   |
| Free space in `/opt/lamalibre/apps`  | The unpacked package + 4 KiB per entry + 64 MiB                   |
| System packages                      | 50, Debian names                                                  |
| Plugin config, service spec          | 64 KiB each                                                       |
| Signed job                           | Valid at most one hour; envelope 32 KiB; 5 s clock skew           |
| Job timeouts on the agent            | install 10 min, activate 2 min, remove 5 min (plus 90 s delivery) |
| Waiting for another helper operation | install 5 min, remove 2 min, config and activate 1 min            |

## What it does not do

- **`lamaste-agent uninstall` refuses** while agent halves are installed for the agents it would remove — they would run on with no tunnel and nobody to remove them. Unhost or uninstall those plugins on the panel first (the agent removes them on its next sync), or `sudo lamaste-agent apphost disable --force` (their data is kept).
- **System packages are never removed** — not on removal, not on purge.
- **No other package managers:** system packages are installed on Debian and Ubuntu only; elsewhere a plugin that declares them cannot be hosted.
- **macOS agents** cannot host an agent half Lamaste installs; an agent half installed by hand is still hosted the 2a way.
- **Settings and secrets** of an agent half (slice 4) are not delivered yet; the plugin config carries the port and the installation secret only.

See [Config Files](../06-reference/config-files.md#agent-machine-the-app-host) for every file with its owner and mode, and [Security Model](../01-concepts/security-model.md#5d-the-app-host-on-agents) for the trust model.
