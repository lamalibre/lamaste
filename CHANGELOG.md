# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.3.0] - 2026-10-17

All lockstep packages, the desktop crate and its Tauri config move to 4.3.0; internal `@lamalibre/*` ranges become `^4.3.0` — Gatekeeper's and `lamaste-cloud`'s too, which accepted any version of `@lamalibre/lamaste` (see Fixed).

### Upgrade notes

**Upgrade the relay first, then the agents.** lamaste-agentd 4.3 accepts a request from the relay only with a relay assertion, which a 4.3 relay sends and an older one does not: a 4.3 agent behind an older relay refuses its agent-panel and plugin-tunnel requests (401) until the relay is upgraded. A 4.3 relay still sends the `X-SSL-Client-*` headers older daemons read, so their panels keep working — with the flaw described under Security — until they are upgraded. This reverses the agents-first order of 4.0, whose Chisel change no 4.2 agent needs.

1. **The relay**: the panel's Update action (`create-lamaste@4.3.0 --yes` in a transient unit) or a `create-lamaste@4.3.0 --yes` redeploy. The redeploy upgrades Node.js from NodeSource when it is older than 22.13 (the hook runner's permission model), installs the hook runner units and `lamaste-priv hooks`, and redeploys Gatekeeper with core 4.3 (see Fixed). On its first start the panel applies migrations `0006`–`0011`, creates its relay signing key (`/etc/lamalibre/lamaste/relay-signing-key.json`, 0600) and rewrites existing tunnel, static site and auth portal vhosts (see Security). Plugins installed before keep working as they did; hosting one on an agent is a new, explicit step.
2. **Check the panel's startup log** (`journalctl -u lamalibre-lamaste-serverd`) for `Left tunnel vhosts as they are`, `Left site vhosts as they are` and `Failed to rewrite … vhost`. A tunnel vhost the panel could not rewrite answers 403 to everyone until it is (Gatekeeper refuses its old subrequest); a static site vhost it could not rewrite still names the client's `Host` to Authelia (see Security). Fix what the log names and restart the panel. Note the key id of `Relay assertion signing key ready` for step 4.
3. **Every agent**: `sudo npm install -g @lamalibre/lamaste-agent@4.3.0`, then `lamaste-agent update` as the agent's user. On Linux agents with the agent panel, `update` also rewrites the panel's user unit so it starts at boot (see Fixed); `lamaste-agent panel --enable` does the same.
4. **Agents that are to host app plugins' agent halves** (Linux, systemd) need `lamaste-agent` installed root-owned — the `sudo npm install -g` of step 3, never a user-owned prefix — and the app host helper enabled once: `sudo lamaste-agent apphost enable` (`--user root` when the agent runs as root). It pins the relay's signing key; compare the key id it prints with the one from step 2. **After replacing the relay's signing key**, run `sudo lamaste-agent apphost pin` on each such agent — until then its helper refuses the relay's app jobs.

Also:

- **Push-install windows opened before this version were never stored** (see Fixed): open them again. A stored default push-install policy whose actions were never edited now also allows `uninstall`; an edited one stays as it is — add `uninstall` to let it remove agent halves.
- Two installed plugins whose names share a route (`fx` and `fx-server`) keep it for the one installed first; the other can be uninstalled but not hosted until it is reinstalled under a route of its own (migration `0010`).

### Added

- **Agent-hosted plugins with an agent half (slice 2a of `plugin-development/design/agent-hosted-app-plugins.md`).** A manifest may add an `agent` block to `"hosting": "agent"` (`agent.requires`: `node`, `os`, `systemPackages` — validated now, checked by the install flow of a later slice); such a plugin may declare panel pages. **Hosting** it on an agent (`POST /api/plugins/:name/hosting {agentLabel}`; `GET`/`DELETE` the same path; the Plugins page; `lamaste-server plugins host|unhost|hosting`) creates, as one operation that rolls back on failure: an **internal plugin tunnel** (`exposure: "internal"` — the chisel grant on a relay-loopback port assigned from the new range **21000–21999**, no hostname, certificate or access mode; listed by `GET /api/tunnels` with `subdomain: null`; not changeable through the tunnels API), a 32-byte **installation secret**, and the implicit capability `plugin:<route>:host` on the hosting agent's certificate. The panel then **forwards** `/api/<route>/*` to the agent half's `/admin/*` over the tunnel — streaming both ways, the tunnel's body limit, a 30 s headers timeout, server-sent events unbuffered, the caller's cookies and `Authorization` never passed, `Set-Cookie` never returned, a clean `502` when the agent half is unreachable — with a signed **caller assertion** (`X-Lamalibre-Caller`: plugin, caller, method, path, 60 s validity, nonce) the agent half verifies with `createCallerAssertionVerifier` from `@lamalibre/lamaste/agent`. The hosting agent's `lamaste-agent sync` fetches the secret (`GET /api/agents/me/plugin-config/:route`, hosting agent only), writes `agents/<label>/app-plugins/<route>.json` (0600) and acknowledges it; **rotation** (`POST /api/plugins/:name/hosting/rotate-secret`, `lamaste-server plugins rotate-hosting-secret`) keeps the previous secret in use until the agent acknowledges the new one. A **health monitor** probes every hosting every 10 s and tells a tunnel that is down from an application that is down (3 failures down, 2 successes up), shown on the Plugins page, `GET /api/plugins/:name/hosting` and `lamaste-server plugins list`. Uninstalling a hosted plugin removes tunnel, secret and capability. Reference: `packages/core/docs/04-api-reference/agent-hosted-plugins.md`.
- **Lifecycle hooks for agent-hosted plugins (slice 2b).** A manifest with an agent half may declare `hooks`: **relay hooks** (install, uninstall, request and tunnel-state stages) that Lamaste runs in a sandboxed per-plugin runner — never in the panel — and **agent hooks** the agent half answers at `POST /admin/hooks/<stage>`. Every Lamaste step is wrapped _relay pre → agent pre → Lamaste → agent post → relay post_: hosting a plugin (`POST /api/plugins/:name/hosting`) and removing it now run its **install / uninstall pipelines** as **operations** (`202 { operation }`, followed at `GET /api/plugins/:name/operations[/:id]`, in the panel and by `lamaste-server plugins host|unhost`); a failing pre stage leaves nothing, a failing post stage rolls back. The installation secret reaches the agent before the tunnel is granted and leaves after it is removed, so the agent's own pre-tunnel and post-teardown stages run on its loopback, delivered as **agent jobs** in `agent-config` and reported to `POST /api/agents/me/jobs/:id/result`. **Request hooks** run in the forwarder on the routes they name (`createHookedForwarder`): `pre-forward` validates and rejects before anything enters the tunnel, `post-forward` passes, replaces or blocks the response; buffering is bounded, fail closed by default (fail-open allowed and shown). **Tunnel-state hooks** follow the health monitor: `tunnel:down` may return the response the forwarder serves while the plugin is down; the agent half is told by its agent's sync from the relay's view. Effects (`audit`, `notify-admins`, `log`) are performed by Lamaste, declared and rate-limited. Reference: `packages/core/docs/04-api-reference/lifecycle-hooks.md`.
- **Approval of relay code.** Relay hooks run only after an administrator approves their **digest** (declarations + the module's SHA-256): `GET /api/plugins/:name/hooks`, `POST …/hooks/approve`, per-plugin **auto-approve** for later changes (off by default, `PUT …/hooks/auto-approve`), the Plugins page's Lifecycle hooks panel and `lamaste-server plugins hooks|approve-hooks|auto-approve`. Every approval is audited with the certificate serial.
- **Shared hook `lamaste:secret-scan`** — scans responses on the routes a plugin names for private keys and provider tokens (`credentials`, `jwt`, `assignments` rule packs), redacting (`[REDACTED:<rule>]`, JSON-safe, no re-serialisation) or blocking; rules are versioned per pack and ride Lamaste releases (`hooks.rules-updated` audited).
- **Updating an agent-hosted plugin in place**: `POST /api/plugins/:name/update {version?}` reads the new version without installing it; a changed relay hook set waits for approval (the installed version stays live) unless auto-approved; the install pipeline runs with `phase: "upgrade"` and a failure restores the previous version. `lamaste-server plugins update|discard-update`, the panel's Update button.
- **Audit log and panel notifications**: `GET /api/audit`, `GET /api/notifications`, `POST /api/notifications/read`, the panel's Audit page, `lamaste-server audit`. Installs, uninstalls, hostings, updates, approvals and plugin hook effects are recorded (metadata only).
- `@lamalibre/lamaste/hooks` (new subpath): the hook contract, `defineRelayHooks`, `defineAgentHooks`, route patterns, the runner protocol and the secret scanner; `@lamalibre/lamaste`: `HooksBlockSchema`, `relayHookSetOf`, `relayHookSetDigest`, `relayHookSetPreview`, `callAgentHalfHook`; `@lamalibre/lamaste/server`: `createHookedForwarder`, `callRelayHook`, `validateHookDecision`, `readTarballFiles`, hosting phases; `@lamalibre/lamaste/agent`: `runAgentJobs`, `syncAgentTunnelHooks`, `createAgentHookHandler`. Caller assertions gain the caller `{ type: 'lamaste' }` (Lamaste's own calls; the health probe uses it).
- create-lamaste: the hook runner units (`lamalibre-lamaste-hooks@.socket/.service`), `lamaste-priv hooks install|activate|restart|remove`, and a Node.js floor of 22.13 (the permission model) checked on install and redeploy.
- serverd migrations `0007_audit_and_notifications.sql`, `0008_plugin_hooks.sql`.
- `@lamalibre/lamaste`: `INTERNAL_PLUGIN_PORT_RANGE`, `isInternalPluginPort`, `pluginHostCapability`, `hasAgentHalf`, `AgentBlockSchema`, caller assertions (`signCallerAssertion`, `verifyCallerAssertion`, `NonceStore`, `generateHostingSecret`); `@lamalibre/lamaste/server`: `createTunnel({ exposure: 'internal' })`, `assignInternalPluginPort`, the plugin hosting store, `agentForwarderPlugin`, `startPluginHealthMonitor`; `@lamalibre/lamaste/agent`: `syncAppPluginConfigs`, `createCallerAssertionVerifier`, the app-plugin config file helpers; `GET /api/tunnels/agent-config` gains `appPlugins`.
- serverd migration `0006_plugin_agent.sql` (`plugins.agent`).
- E2E: single-VM `29-agent-hosted-plugin-forwarding` and three-VM `31-agent-hosted-plugin-tunnel` (asynchronous hosting); single-VM `30-lifecycle-hooks` (approval, the hook runner's sandbox, request hooks, secret-scan redaction, fail-closed timeouts, tunnel fallback, updates and auto-approve, rollback) and three-VM `33-lifecycle-hooks-agent` (agent jobs before the tunnel and after it, tunnel:down/up on both machines, rollback on failing agent stages) — all green on fresh VMs.
- **App plugins' agent halves installed onto an agent from the panel (slice 3).** A manifest's `agent` block may name the agent half's package and how it runs: `agent.package` (an `@lamalibre/` package published at the plugin's version, one bundled tarball) and `agent.service` (`entry`, optional `memoryMax`). Installing such a plugin — or staging an update — pins the package's tarball integrity from the registry (`npm view … dist.integrity`, SHA-512 only), and the approval digest covers it with the service and the system packages (`agent.requires.systemPackages`). **Hosting** it then installs the agent half as a step of the install pipeline, after the reservation and before the agent's `install:pre-tunnel`, as an `app-install` agent job: the agent's sync fetches exactly the pinned tarball (`npm pack --ignore-scripts` with a panel-brokered registry token), checks its SHA-512 and hands it to the agent's root helper, which installs and starts it as a hardened systemd service under an account of its own. **Unhosting** and **uninstalling** remove it (`app-remove`; data and account kept unless `?purge=true`, `--purge`, or the panel's purge option); an **update** installs and activates the new agent half before the relay package and activates the previous version on failure (`app-activate`); a rollback removes it again. Each is a **push**: the agent must be eligible — `GET /api/plugins/:name/hosting/eligibility`, `lamaste-server plugins eligibility`, the host dialog; `409 agent_not_eligible` with the reasons — and the push-install gates must allow `install`, `update` or `uninstall` of the agent package (`push_install_refused`). Auto-approve covers a new version of the same agent half but is withheld for one that changes what runs as root (a new agent half, another package, added system packages, another service entry or memory limit; `hooks.auto-approve.withheld`). New audit actions `plugin.agent-half.installed|activated|removed|purged|retained-data.forgotten`. A manifest without `agent.package` is hosted as before, its agent half installed by hand. Reference: `packages/core/docs/04-api-reference/agent-hosted-plugins.md` (Hosting with an agent half) and the new `app-host.md`.
- **`lamaste-apphost`, the app host helper** (shipped in `@lamalibre/lamaste-agent`): a root-owned Node.js program using built-ins only, installed with one sudoers rule (`env_reset`, Node.js variables deleted, validated with `visudo -c`) by `sudo lamaste-agent apphost enable` — only from a root-owned install — with `pin`, `status`, `relay-keys`, `remove` (as the operator, for an agent its relay cannot reach) and `disable`. It validates every argument, derives every path, takes content on stdin and never echoes it; checks and unpacks the tarball itself (POSIX ustar, only regular files and directories under `package/`, no links or devices), enforces the bundled rule (no dependencies, no install scripts, no `binding.gyp`) and installs every file root-owned 0644. It creates the account `lamaste-app-<route>` (`lamaste-app-<2 characters>-<16 hex of SHA-256>` for routes over 18 characters; its route in the comment), `/opt/lamalibre/apps/<route>/<version>` with `current` and `previous`, `/var/lib/lamalibre/apps/<route>` (0700), `/etc/lamalibre/apps/<route>/plugin-config.json` (0600), a root-owned owner record per route, installs approved system packages with `apt-get --no-install-recommends` (Debian and Ubuntu), and writes `lamalibre-app-<route>.service` from a fixed template: no capabilities, `NoNewPrivileges`, `ProtectSystem=strict` with only the data directory writable and `/run` read-only (strict leaves it writable; `/run/lock` is world-writable), private `/tmp`, devices and IPC, an empty `/dev/shm` it cannot write, `ProtectProc=invisible`, the kernel, clock and hostname protections, `@system-service` system calls (`EPERM` otherwise), IP and Unix sockets only, `UMask=0077`, `MemoryMax`. At most 50 agent halves per machine, with a free-space check; a failed install restores the version before. Converge hands a fetched plugin config to the service before acknowledging it, so a rotation needs no restart. Exit status 0–5 (2 refused, 3 not installed, 4 another agent's or package's route, 5 not signed by the relay).
- **Host facts**: each agent's sync reports its OS, distribution (`/etc/os-release`), architecture, Node.js, whether systemd runs and its app host helper (protocol, Node.js, the id of the pinned relay key) to `PUT /api/agents/me/host-facts` when they change and once a day; kept on the agent's record (`hostFacts`, `hostFactsAt` on `GET /api/certs/agent`), shown on the Certificates page and in the host dialog, and checked against `agent.requires`.
- **Retained data**: an agent half removed without purge leaves its data directory and account on the agent, and the relay keeps a record by the plugin's name (`retainedData` on `GET /api/plugins`, `GET /api/plugins/:name/retained-data`; each record names the `dataDir` and `serviceUser` a purge deletes). `DELETE /api/plugins/:name/retained-data?agentLabel=<label>` purges it through the agent (an operation, push-gated as `uninstall`); `&forget=true` drops only the record. Hosting the same agent package there again takes the data back; another package is refused (`409 retained_data_conflict`).
- **Retained data in the panel, the server CLI and the desktop app.** The Plugins page lists the records under **Retained data** on a plugin's card and, for uninstalled plugins, in a section of its own, each with **Purge** — an operation the page follows like the others; its confirmation names the agent, the route, the data directory (`/var/lib/lamalibre/apps/<route>`) and the account — and **Forget**, whose confirmation says the data stays on the machine and how to remove it there. `lamaste-server plugins retained-data [<name>] [--json]`, `purge-data <name> --agent <label>` (says what it deletes, follows the operation) and `forget-data <name> --agent <label>`. `AdminClient` gains `getPluginRetainedData`, `purgePluginRetainedData` and `forgetPluginRetainedData` (desktop commands `admin_get_plugin_retained_data`, `admin_purge_plugin_retained_data`, `admin_forget_plugin_retained_data`), and `getPlugins` declares the top-level `retainedData`; `@lamalibre/lamaste` exports the `RetainedAgentData` type, `@lamalibre/lamaste/agent` `agentsRegistryPathIn`.
- An update in place that adds a confidential OIDC client shows the new client's secret once, on the finished operation: `oidcClients` on the first read of `GET /api/plugins/:name/operations/:id` after it ended, which `lamaste-server plugins update` (and `approve-hooks`, when approving starts the update) prints. **The panel's Plugins page and the desktop app show these secrets too** — those an install or enable answers with, and those of a finished update — in a dialog with copy and a stored confirmation, carried from the response to the dialog and never into the page's query cache, the browser's storage or a log (before, the panel dropped them and the client's secret could only be rotated). `GET /api/plugins/:name/operations` marks an operation whose secrets still wait (`revealPending`); one started elsewhere — the CLI, another panel — is offered rather than read, so its own follower keeps its one read.
- `lamaste-server push-install status|on|off|default-policy|open|close` — the switch, the policies and every agent's window, and opening a window (`--minutes`, default 30) — and a Push install section on the panel's Plugins page, which the host dialog links to. `GET /api/plugins/push-install/config` reports the window bounds (`windowMinutes`, 5–480), which opening a window enforces; a push that passes the gates is logged with its operation.
- `@lamalibre/lamaste`: `AgentBlockSchema` `package`/`service`, `agentHalfOf`, `agentHalfPreview`, `APPHOST_PATHS`, `APPHOST_PROTOCOL_VERSION`, `appServiceUser`, `appUnitName`, `HostFactsSchema`, `hostEligibility`, `approvalDigest`, `AGENT_APP_JOB_TIMEOUTS`, `AgentJobResultSchema`, `parseRelayKeysResponse`, and relay-signed app jobs (`signAppJob`, `verifyAppJobSignature`, `decodeAppJobSignature`, `appJobEnvelopeMatches`, `canonicalJson`); `@lamalibre/lamaste/agent`: `runAppHost`, `appHostStatus`, `readRelayPin`, `gatherHostFacts`, `syncHostFacts`, the `apphost-state.json` record, app job handlers for `runAgentJobs`. serverd migrations `0009_plugin_agent_half.sql`, `0010_plugin_routes_and_retained_data.sql`, `0011_agent_job_signature.sql`.
- E2E three-VM `34-app-plugin-install` (the plugin hosted from the panel with only the operator's `apphost enable` on the VM: refusals before approval, without the helper, with push install off and the window closed; the installer contract's paths, owners, modes and hardening on the VM; a stand-in Feria logging the agent's pull; purge leaves nothing), `35-app-plugin-operate` (rotation reaching the service, a reboot, an update and a failed update restoring the previous version) and `36-app-plugin-removal` (unhost keeps data; a wrong integrity, a package with `dependencies` and a closed window refused) — three specs because rodeo stops a spec after ten minutes. Green on fresh VMs (2026-10-16), with the full three-VM suite (36/36) and the full single-VM suite (29/29).
- **Relay assertions** (see Security). `@lamalibre/lamaste`: `signRelayAssertion`, `verifyRelayAssertion`, `createRelaySigner` (the key file: created exclusively, re-read on a content or permission change, refused when other users can read it), `parseRelayVerifyKey`, `relayVerifyKeyOf`, `relayKeyId`, `urlIsUnderRoute`, `RELAY_ASSERTION_HEADER`, `RELAY_SIGNING_KEY_FILE` and the payload types; `@lamalibre/lamaste/server`: `authorizeAgentPanelRequest`, `findAgentPanelTunnel`. serverd: `GET /api/agents/me/relay-keys` (the public key and the label the relay knows the calling agent by), `GET /api/agent-panel/authz/:label` (the agent-panel vhost's `auth_request` target), and a startup reconcile of tunnel, static site and auth portal vhosts with the generators. `startPanelServer(label, { port, panelApi })` takes a stand-in panel client for tests. Tests for lamaste-agentd's authentication against its real route table, Gatekeeper (`npm test` there and in `@lamalibre/lamaste-agent`, new), the authz route, the vhosts and the reconcile; E2E three-VM `32-agent-panel-relay-auth` and updated specs 15, 19 and single-VM 23, 24 — green on fresh VMs (2026-10-16). Reference: `packages/core/docs/01-concepts/security-model.md` (5c).

### Changed

- `POST`/`DELETE /api/plugins/:name/hosting` answer `202 { operation }` (they run the plugin's install / uninstall pipelines); `DELETE /api/plugins/:name` does the same for a hosted plugin. Both accept `?force=true` to pass failing pre-teardown hooks.
- The forwarder refuses a path segment with an encoded `/` or `\` (400) and never forwards `/admin/hooks/*` (404).
- `audit` and `notifications` are reserved API prefixes (plugin names).
- Installing a plugin by a pinned spec (`@lamalibre/x@1.2.3`) records the bare package name (the manifest is resolved by it); a manifest naming a plugin already installed by another package is refused before the registry write.
- `isTunnelPortAllowed` and the tunnel routes refuse ports 21000–21999 for tunnels created by hand; a tunnel already on such a port keeps it. `TunnelEntry.subdomain` and `fqdn` may be `null` (internal tunnels); Gatekeeper and site validation skip them.
- **Plugin routes are unique.** A plugin's route (its name without `-server` or `-agent`) keys its API, capabilities, OIDC client ids, hosting and agent half, so installing a plugin whose route another installed plugin holds is refused (`409`, `code: "route_taken"`, with `route` and `owner`; migration `0010`). A plugin with an `agent` block is named exactly its route (`400` otherwise); one that shares a route from before can be uninstalled but not hosted (`route_conflict`). Every hosting record names the plugin that owns it, and no operation acts on another plugin's hosting (`hosting_owner_mismatch`).
- The approval digest covers what Lamaste installs on the agent as well as the relay hooks (`approvalDigest`, version 2: `{ relay, agentHalf }`); `GET /api/plugins/:name/hooks` returns `agentHalf` (package, version, integrity, entry, memory limit, system packages, account, unit, data directory) and `approval.digest`, and `pendingUpdate` is `{ version, digest, stagedAt, relay, agentHalf, autoApproveWithheld }`. `lamaste-server plugins hooks` prints them.
- `GET /api/certs/agent` entries carry `status` (`active`, `expiring-soon`, `expired`, `revoked`), `hostFacts` and `hostFactsAt`.
- Agent jobs carry kinds besides `hook` — `app-install`, `app-activate`, `app-remove` — with their parameters and the relay's signature (`agent-config.agentJobs`); `POST /api/agents/me/jobs/:id/result` takes `{ ok: true, app: { version, unit } }` for them, from the agent the job is for.
- The default push-install policy allows `uninstall` (removing an agent half is a push).
- `lamaste-agent uninstall` refuses while the app host helper runs agent halves for the agents it would remove; unhost them on the panel, or `sudo lamaste-agent apphost disable --force` (their data is kept).
- The agent's sync unit (Linux) allows a run 20 minutes (`TimeoutStartSec=20min`): it now also installs agent halves, which may take 10.
- The panel takes a client's address from `X-Forwarded-For` only when the connection is its local nginx's (one loopback hop) — the address push-install IP policies, rate limits and logs see.
- **App hosting serves one OS user per machine.** `sudo lamaste-agent apphost enable --user <name>` (or `--user root`) no longer silently replaces a sudoers rule that names another user — that user's agents could no longer install, update or remove their agent halves; it is refused, saying so, unless `--force`.
- `sudo lamaste-agent apphost enable|pin` pin a relay key only for a label the agent user's own agent registry lists — root reads `~/.lamalibre/lamaste/agents.json` in that user's home (from the user database) itself, only as a regular file that user owns, never through a link — and, for any user but root, never for a label root's own agents use (a pin is per label for the whole machine). They print each pinned key id, the one pinned before on a re-pin, and where to compare them with the relay's.
- The refusals that sent an administrator to the raw API for retained data — `retained_data_conflict`, `agent_not_enrolled` and the `400` of uninstalling an unhosted plugin with `purge` — name the panel's Retained data and `lamaste-server plugins purge-data|forget-data` instead.
- The legacy `POST /api/plugins/push-install/:label` says what it does: it records the command in the push-install log (`… recorded in the push-install log; nothing delivers it to the agent`), where it claimed to have sent it. Nothing ever delivered it; what Lamaste pushes to agents runs as plugin operations.
- `lamaste-agent` lists all `apphost` subcommands in its help (`relay-keys` and `remove` were missing).

### Fixed

- **Gatekeeper accepted any version of `@lamalibre/lamaste`** (`"*"`), and so did `@lamalibre/lamaste-cloud`. A redeploy keeps Gatekeeper's `node_modules` and lockfile, and `npm install` keeps an installed core that satisfies the range: a relay redeployed from 4.2 would have run Gatekeeper 4.3 on core 4.2, which lacks the relay assertion it imports, and Gatekeeper would not have started. Both now require `^4.3.0`, like every other package of the release.
- **Uninstalling a plugin did not revoke its capabilities from agents.** The sweep wrote the retired `pki/agents/registry.json`; agents live in `state.db` since 4.0, so a reinstalled plugin silently got the old grants back. It now edits the registry the panel reads.
- Hosting and uninstalling the same plugin could interleave; one operation per plugin now runs at a time.
- **Push-install windows were never stored, so every push was refused.** The registry code set an agent's `pushInstallEnabledUntil` and `pushInstallPolicy`, but the SQLite `agents` table (since 4.0) had no columns for them: opening a window answered success and the next read had none, so the window gate refused every push (`403`). Migration `0009` adds the columns; windows and policies persist.
- The push-install routes (`/api/plugins/push-install/enable/:label`, `/api/plugins/push-install/:label`) refused agent labels over 50 characters, which enrolment allows up to 63; they take every valid agent label now.
- **The agent panel did not start at boot on Linux.** Its systemd **user** unit was enabled into `multi-user.target`, a target only the system manager has: `systemctl --user enable` made a link nothing pulls in, so even with lingering the panel came back only when started by hand. New units name `default.target`; `lamaste-agent update` and `lamaste-agent panel --enable` rewrite an older unit and re-enable it when it was enabled.
- **An invalid plugin manifest was answered as "not found" at install and as a `500` at update.** serverd recognised a manifest error by zod's `ZodError` class, and the core library's copy of zod is another one, so its errors were never instances of it. `validateManifest` throws core's own `ManifestValidationError` (with the `issues`), and installing or updating with an invalid manifest answers `400` with what is wrong.
- **Registry credential `--oidc` named a Feria configuration that cannot exist.** When the registry refuses the panel, the error (and the API reference) told the operator to add a `rules` issuer for `https://auth.<domain>`. Feria keys trusted issuers by `iss` and refuses one listed twice, and the relay's users already log in through that issuer as a `groups` issuer — so the advice made Feria fail to start. It now points at a `workloads` rule on that `groups` issuer (Feria 0.3.2 or later) granting `admin` to `client_id` `lamaste-server`.

### Security

- **create-lamaste ran the NodeSource setup script as root from a fixed path in the shared `/tmp`** (`/tmp/nodesource_setup.sh`), where another local user could have put a file or a link first. It now downloads the script into a private temporary directory (`mkdtemp`, 0700) and removes the directory on every path.
- **lamaste-agentd trusted request headers for who was calling.** The agent daemon listens on `127.0.0.1:9393`. It took a request carrying `X-SSL-Client-Verify: SUCCESS` as coming through the relay's agent-panel vhost and read the caller from `X-SSL-Client-DN` — `CN=admin` meant full access, plugin install included (code execution as the agent's user) — and took `Remote-User` as an Authelia user on plugin routes. Any OS user on the agent machine, and any process on the relay (through the panel tunnel's port on the relay's loopback), could send those headers. The daemon now accepts the relay only with a **relay assertion**: `X-Lamalibre-Relay-Assertion`, an Ed25519 signature by the relay over the agent, the tunnel port, the caller, the method and target, the issue time and a nonce — valid 60 seconds, once. The panel signs it for the agent-panel vhost (an nginx `auth_request` per request, which also refuses a **revoked** certificate — the agent panel could not check revocation before) and Gatekeeper for Authelia users on plugin tunnels, with a key only the relay holds (`/etc/lamalibre/lamaste/relay-signing-key.json`, 0600); agents hold the public key, fetched over their pinned mTLS channel. `X-SSL-Client-*` and `Remote-*` are stripped from every request; `Remote-*` are set again only from a verified assertion, so plugins reading identity headers read the relay's word. The owner's Bearer token (`agentd.token`) is unchanged. A relay process that can forge the panel's own `X-SSL-Client-*` headers on `127.0.0.1:3100` can still obtain an assertion — the relay's loopback remains the relay's trust boundary, and with panel 2FA on such a process (or a stolen admin certificate) still reaches every agent panel, which panel 2FA never covered.
- **The desktop app put the agentd token in curl's arguments.** Its calls to lamaste-agentd passed `-H "Authorization: Bearer <token>"` on the command line, which other local users can read (`/proc/<pid>/cmdline` on Linux) — and the token is the daemon owner's full access. The token now reaches curl on stdin (`-H @-`).
- **Tunnel and static site authorization followed the client's `Host` header, not the hostname requested.** nginx selects a vhost from the request line when it is in absolute form (`GET https://a.example.com/ HTTP/1.1`) and from `Host` otherwise, but the Gatekeeper subrequest of `authenticated` and `restricted` tunnel vhosts (`/authz/check`) built `X-Original-URL` and `Host` from `$http_host` — the client's `Host` header. A request line for one tunnel sent with the `Host` of another was authorized for the other and served by the first: any Authelia user allowed on any tunnel — every user, on an `authenticated` one — reached every `restricted` tunnel, app or plugin, without a grant, and Authelia was asked about the other URL too. Authelia-protected static sites asked Authelia the same way, so any user reached a site restricted to other users (`allowedUsers`). Agent panels were not affected (mTLS, and the panel's check names the agent in its path). A tunnel vhost now names its tunnel in the subrequest's path, `/authz/tunnel/<fqdn>`, and every authorization subrequest — tunnels, static sites and, as hardening, the auth portal — writes the vhost's own hostname into `X-Original-URL` (and `Host`), as does a tunnel's login redirect; the client's `X-Forwarded-Host/-Proto/-Uri/-Method` are cleared there, and the generators refuse a hostname that is not a plain DNS name. Gatekeeper authorizes the tunnel in the path, refuses a check whose `X-Original-URL` or `Host` names another hostname or has no `Host`, and refuses `/authz/check` outright, so a vhost written before 4.3 closes its tunnel instead of opening it. The panel rewrites existing vhosts when it starts — tunnels once it listens, the auth portal and static sites before — on the certificate they name; a rewrite never links a vhost that is not linked and never adds or removes authentication (the agent-panel vhost, which gains the panel's `auth_request`, aside). The installer's nginx authorization cache snippet, which no vhost includes, keyed decisions on `$http_host` as well; its key is now `$server_name|$cookie_authelia_session`. nginx commands the panel runs (`lamaste-priv`, `nginx -t`, reload) time out after 60 seconds. Tests: the vhost text and its rollout (`nginx-vhosts`, `vhost-reconcile`), Gatekeeper's tunnel binding (`authz-host-binding`), and three-VM E2E `22-restricted-tunnel-grant` (written; needs the VMs), which also checks that an old-form vhost closes its tunnel and that the panel's rewrite reopens it.
- **Root on the agent only for what the relay signed.** Installing an agent half needs root on the agent, which `lamaste-agent` never had. The only new privilege is the app host helper: one root-owned program the agent's user may run through one sudoers rule its operator installs. It installs, switches or removes an agent half only for a job the relay signed with its Ed25519 relay key when it created it — over the agent's label, the route, the job id, the kind and the exact payload (package, version, tarball integrity, service, system packages; the version or the purge flag), valid at most an hour — verified against the key pinned for that agent by `sudo lamaste-agent apphost enable|pin` (fetched over the agent's pinned mTLS channel; trust on first use — compare the key id with the relay's), and runs each job once. A root-owned owner record keeps one relay's agent, or one package, off another's route and data; the account an agent half runs as names its route. Plugin code never runs as root: each agent half runs under its own account with no capabilities, its code root-owned and read-only, writing only its data directory. A compromised agent account can still rewrite the plugin configs it holds and choose when, or whether, a signed job runs; it cannot install, switch, remove or purge anything the relay did not sign. Reference: `packages/core/docs/01-concepts/security-model.md` (5d).
- **lamaste-agentd checked the URL, not the route, to decide whether a caller was needed.** The router decodes percent-escapes, so `/%61pi/status` and `/%61pi/config` were answered as `/api/...` and every route of a hosted plugin (`/%68erd/...`, also `/<plugin>` and `/<plugin>?...`) with no credential at all. Authentication now follows the matched route: every route needs a caller except those marked public (the health check, the plugin bundles, the SPA's files), and so does a path no route matches under an installed plugin's name, which a plugin's own not-found handler would answer.

## [4.2.0] - 2026-10-14

All lockstep packages move to 4.2.0; internal `@lamalibre/*` ranges become `^4.2.0`.

### Upgrade notes

- Update the server with Panel Update (or a `create-lamaste` redeploy), as for 4.1. Agents may stay on 4.1 for everything the relay does; a 4.2 agent also refuses to load an agent-hosted plugin installed on it locally, which a 4.1 agent would import.
- serverd adds the `plugins.hosting` column on start (migration `0005_plugin_hosting.sql`); every plugin installed before is a server plugin and behaves as before.
- **Install an agent-hosted plugin only on a 4.2 server.** Earlier servers drop the unknown `hosting` field and would import the package on enable — for `@lamalibre/feria-server` 0.3.1 that is the Feria CLI.
- `lamaste-server plugins` needs the panel to be running (it now goes through the panel's API).

### Added

- **Agent-hosted plugins, identity only.** A plugin manifest may say `"hosting": "agent"` (default `"server"`): the application runs on its own agent behind a Lamaste tunnel, and the relay needs only what the manifest declares. It installs like any plugin (`POST /api/plugins/install`, `npm install --ignore-scripts`, manifest from `<package>/lamaste-plugin.json`), but Lamaste never imports its package — neither the panel's plugin host nor an agent's — mounts nothing under its route (requests there answer 404), serves no panel bundle and binds no storage to it (400). Its `oidcClients` are written to Authelia on enable and removed on disable or uninstall, and its `capabilities` are registered, exactly as for a server plugin. A `panel` declaration on an agent-hosted plugin is a manifest error. The panel's and the agent's plugin lists and `lamaste-server plugins list` show the hosting. First consumer: Feria (`@lamalibre/feria-server`), whose `feria-cli` client the relay serves without running any Feria code.
- `@lamalibre/lamaste`: `PLUGIN_HOSTINGS`, `DEFAULT_PLUGIN_HOSTING`, `isAgentHostedPlugin`, type `PluginHosting`; `hosting` on `ManifestSchema`, `PluginManifest` and `PluginRegistryEntry`.
- E2E (single VM): `28-agent-hosted-plugin` — a fixture whose main module throws if imported is installed and enabled, its client reaches Authelia, discovery and JWKS answer, its route 404s after a panel restart, the panel stays healthy, a variant declaring panel pages is refused, and disabling removes the client.

### Changed

- `lamaste-server plugins list` reads the plugin registry from the running panel (`GET /api/plugins`) instead of `plugins.json`, which the panel has not read since its registry moved to SQLite.
- `lamaste-server plugins install|enable|disable|uninstall` go through the running panel (`/api/plugins/*`, admin certificate) and need it to be up; they no longer re-run themselves as `lamaste` (the panel runs npm as that account). A plugin that fails to load is skipped by the plugin host, so the panel stays reachable to disable it. The panel is restarted after enabling or disabling a server-hosted plugin only; install and uninstall need no restart. Secrets of confidential OIDC clients created by an install or enable are printed once.

### Fixed

- The npm pages of `@lamalibre/lamaste-agent-ui` linked to the repository's pre-transfer address; `lamaste-agent-ui` and `lamaste-server-ui` now name `github.com/lamalibre/lamaste`.
- `lamaste-server plugins install|enable|disable|uninstall` changed nothing the panel serves: they wrote `plugins.json` through the core library, while the panel has read its plugin registry from SQLite (`state.db`) since 2.0, and they never synced OIDC clients to Authelia. A plugin installed with the CLI was invisible to the panel and its clients never reached Authelia. E2E spec 28 now runs the whole lifecycle through the CLI as well.
- A multi-page plugin manifest (`panel.pages`) lost its pages on the panel: the manifest schema tried the single-page panel shape first, which matched and stripped `pages`, so the panel's sidebar never showed them and `apiPrefix` was never checked. The multi-page shape is now tried first.

## [4.1.0] - 2026-10-13

All lockstep packages move to 4.1.0; internal `@lamalibre/*` ranges become `^4.1.0`.

### Upgrade notes

- **Upgrade the server with `create-lamaste` (redeploy), not only the npm packages.** The redeploy generates the OpenID Connect issuer key `/etc/authelia/oidc-issuer.pem`, enables Authelia's `template` configuration filter, and rewrites the panel unit with the `HOME` and npm cache that panel-side plugin installs need. A panel updated without the redeploy cannot serve plugin OIDC clients.
- Agents and server can be upgraded in either order. A 4.1 agent treats a 4.0 server's missing `/api/agents/me/registry-credential` as "no brokered credential"; a 4.0 agent never calls it and installs plugins as before.

### Added

- **Authelia is the relay's OpenID Connect provider.** A plugin manifest may declare OIDC clients (`oidcClients`): public clients for the device-code and authorization-code flows, and confidential clients (`confidential: true`) for the client-credentials grant. The panel writes them into `identity_providers.oidc` when the plugin is enabled and removes them when it is disabled or uninstalled; Authelia restarts only when the section changed. Access tokens are RS256 JWTs (RFC 9068) a resource server verifies against `https://auth.<domain>/jwks.json`; `accessTokenClaims` (`groups`, `preferred_username`, `name`, `email`, each requiring its scope) renders a per-client claims policy so those claims are in the token, not only in UserInfo. First consumer: Feria's `feria-cli`, so `feria login` authenticates through the relay and Feria maps the `groups` claim to registry scopes.
- **Confidential client secrets are generated by the panel.** Minted when the client first appears (at install), stored at `/etc/lamalibre/lamaste/oidc-clients.json` (0600) and written to Authelia only as a pbkdf2-sha512 digest. Shown once — `oidcClients: [{ id, secret }]` on the install or enable response — and again by `POST /api/plugins/:name/oidc-clients/:clientId/rotate-secret`; `GET /api/plugins/:name/oidc-clients` lists metadata without secrets. CLI: `lamaste-server plugins oidc-clients <name>`, `lamaste-server plugins rotate-secret <name> <clientId>`. Uninstalling the plugin deletes the secret.
- **The panel brokers npm registry tokens for agents.** An admin stores one credential for the Lamalibre registry (Feria) with `PUT /api/registry-credential` or `lamaste-server registry-credential set --url <registry> (--oidc | --token-stdin)`; it is verified against the registry first and never echoed back. `GET /api/agents/me/registry-credential` (agent certificate, identity from the certificate) returns a one-hour read-only token owned by `agent:<label>`, which the agent daemon writes to a throw-away 0600 npm userconfig (`npm_config_userconfig`) for that one `npm install` and deletes afterwards — the service account's `~/.npmrc` is never touched. The token is cached per agent until five minutes before it expires; an agent is issued at most ten new tokens per hour (429 with `Retry-After`). Losing a `feria-*` group, or being deleted, revokes the user's registry tokens (best effort, reported as a warning).
- **The panel's own service principal (`--oidc`).** Instead of a pasted long-lived token, the panel can authenticate to the registry as a confidential OIDC client `lamaste-server` on the relay's Authelia (client-credentials grant, scope `lamaste.registry`, audience = the registry): it obtains a JWT from Authelia, exchanges it at the registry's login for a short-lived token, and caches that until five minutes before expiry. Setting the credential verifies the whole chain (Authelia → registry login → `whoami` with the `admin` scope) before storing it and, when the registry refuses, explains that its `auth.json` needs a `rules` issuer for `https://auth.<domain>` granting `admin` to `client_id` `lamaste-server`. Nothing long-lived is stored but the client secret the panel generated itself.
- `create-lamaste` generates the OpenID Connect issuer key `/etc/authelia/oidc-issuer.pem` (RSA 4096) on a fresh install and on every redeploy that finds it missing — as the `lamaste-authelia` account, mode 0600 — and runs Authelia with the `template` configuration filter (`X_AUTHELIA_CONFIG_FILTERS=template`, on the unit and on `lamaste-priv authelia-totp`).
- `@lamalibre/lamaste`: `OIDC_ACCESS_TOKEN_CLAIMS`; `@lamalibre/lamaste/server`: `oidc-clients` (secret store, `encodePbkdf2Sha512Digest`), `renderOidcClaimsPolicies`, `oidcIssuerKeyTemplateLine`, `sentinelizeAutheliaConfig`, `renderAutheliaConfigTemplate`, `lamasteServerOidcClient`, `requestClientCredentialsToken`, `loginToRegistry`, `RegistryServiceTokenCache`, `AgentTokenBroker`, `migrateRegistryCredentialConfig`.
- E2E (single VM): `26-oidc-provider` and `27-registry-credential-broker`, against a stand-in Feria and a fixture plugin that `helpers.sh` writes out.

### Security

- **The panel never holds the OIDC issuer key.** Authelia's configuration references `/etc/authelia/oidc-issuer.pem` with a template expression (`{{ secret "…" }}`) that Authelia expands at load time; the file is readable by the Authelia account only. The panel writes the configuration, so a key it generated or inlined would have been a key it could sign identities with. Because the configuration is now a Go template, the panel refuses to write any value containing `{{` or `}}`.
- Root never writes the issuer key through `/etc/authelia`, a directory the panel owns: the key is generated in the installer and written by a child process running as the Authelia account (`wx`, 0600, renamed into place); a symlink planted at the key's name is replaced, not followed.

### Changed

- `registry-credential.json` stores the credential as `auth: { kind: 'token', token } | { kind: 'oidc', clientId: 'lamaste-server' }`; a file written with the token at the top level is read as before. `PUT /api/registry-credential` takes `auth` (a top-level `token` is still accepted); `GET` reports `auth` and `clientId`.

### Fixed

- `lamaste-server registry-credential clear`, `tunnels delete` and `sites delete` were refused by the panel with 400 ("Body cannot be empty when content-type is set to 'application/json'"): the CLI's panel client sent a JSON content type on every request, body or not. The content type and body now travel together, and a non-2xx answer is reported with the panel's error message. Found by single-VM spec 27.
- **The agent panel stayed stopped after enabling or disabling a plugin.** `lamaste-agentd` restarted itself after a plugin enable or disable by unloading its own service and loading it again — on Linux `systemctl --user disable --now` stopped the daemon before the load ran, and on macOS `launchctl unload` of its own job had the same effect (an unloaded job is not resurrected by KeepAlive), so the response never arrived and the panel stayed down until someone ran `lamaste-agent panel --enable`. The daemon now sends the response first and then hands the restart to the service manager in a detached child (`systemctl --user restart`, or `launchctl kickstart -k`); clients re-poll `/api/health`. Found by the new three-VM spec 10.
- **Panel-side plugin installs failed on every 4.0 server.** `POST /api/plugins/install` ran `npm install` as the `lamaste` service account, which has no home directory (`useradd --no-create-home`) and whose unit hides `/home` (`ProtectHome=true`), so npm died with `EACCES … mkdir /home/lamaste/.npm/_cacache/tmp` before anything was installed. No E2E spec installed a real plugin through the panel until the new OIDC provider spec did. The panel's unit now sets `HOME` and `npm_config_cache` inside the state directory (`/etc/lamalibre/lamaste`, `/etc/lamalibre/lamaste/.npm`), as `lamaste-server plugins` already did; the unit is rewritten on every redeploy, so a 4.0 server gets the fix on upgrade.
- The desktop app showed no servers on a machine without an enrolled agent. It listed, activated and removed servers, and read and changed a server's mode and admin certificate, through the agent daemon — which only runs for an enrolled agent — while creating a server wrote the registry file directly. These commands now work on the registry file, like the ones that create servers, and the Servers page shows a load error instead of "No servers yet". Rewriting the registry also no longer drops fields the desktop does not know (`activeMode` was lost on every save).
- Desktop app started from Finder or the Dock could not run `node`, `npm` or any globally installed CLI: it inherited the session's minimal PATH instead of the user's shell PATH, so token validation, server creation and agent installs failed when Node.js came from Homebrew or a version manager. The app now adopts the login shell's PATH at startup.
- Creating a server failed at the droplet step with `422 … invalid key identifiers` (`lamaste-cloud`). The provisioning SSH key's numeric ID was sent as a string, which DigitalOcean reads as a fingerprint; it is now sent as a number, and the request is retried briefly when a key uploaded a moment earlier is not yet visible to the Droplet service.
- The Create Server wizard reported every token-validation failure as "Token rejected" with a list of scopes to select, hiding the actual error. It now shows the error and reserves the scope hint for tokens whose scopes are wrong.
- `@lamalibre/lamaste-serverd` published its tests and its development `panel.json`; the package now ships `src` only.

## [4.0.0] - 2026-09-30

All lockstep packages move to 4.0.0, the first release of the `lamaste` packages on npm (3.0.0 was published to the development registry only; the tree still said 2.0.0).

### Upgrade notes

- **Upgrade agents first, then the server.** Agents older than this release reject the new `chiselArgs` shape; a new agent works against an old server.
- **Install the agent globally:** `npm install -g @lamalibre/lamaste-agent`. `lamaste-agent setup` and `update` refuse to run from `npx`, because they install a sync timer that runs the installed program every 30 seconds. After upgrading an existing agent run `lamaste-agent update` once to install the timer.
- Re-run the server installer (`npx @lamalibre/create-lamaste`) to redeploy. It installs chisel 1.12.0 and Authelia 4.39.28 (pinned, digest-verified) with their units; creates the `lamaste-chisel` group and the `lamaste-authelia` account; hands `/etc/authelia` and `/var/www/lamaste` to the panel user and moves Authelia to its own account (Authelia is stopped for the handover and started again); replaces the lamaste-owned `/opt/lamalibre/lamaste` with a root-owned one (every component is redeployed into it); installs `lamaste-priv` and the new sudoers file; and adds the port-80 redirect. On its next start the panel rewrites the chisel authfile.

### Security

- **Tunnels belong to one agent, enforced by chisel.** Every tunnel now has an owning agent (`agentLabel`). The chisel authfile grants each `agent-<label>` user exactly the anchored reverse remotes (`^R:127\.0\.0\.1:<port>$`) of the enabled tunnels it owns. Previously every credential was granted `.*`, so any enrolled agent could bind any tunnel's port on the relay and take over its hostname. `GET /api/tunnels/agent-config` returns only the calling agent's tunnels, and agent certificates can only list, update and delete their own tunnels. A port claimed by two tunnels is granted to no one.
- **Tunnels can no longer reach the relay's own services.** Ports 3100, 9090, 9091, 9292 and 9294 (panel, chisel, Authelia, IP panel, Gatekeeper) are rejected as tunnel ports, in the schema, the tunnel workflow and the chisel grants. Tunnel vhosts also clear client-supplied `X-SSL-Client-Verify/DN/Serial` headers. Together these allowed an agent with `tunnels:write` to publish the panel API through a tunnel hostname and pass as an administrator by sending `X-SSL-Client-Verify: SUCCESS`.
- **Chisel never runs unauthenticated.** Chisel disables authentication when its authfile has no users, which made a freshly installed relay — or one whose agents were all revoked — an open reverse proxy. The authfile now always carries a grant-less `lamaste-no-grants` user (random password in `/etc/lamalibre/lamaste/chisel-sentinel`, 0600, never handed out).
- **The chisel authfile is no longer world-readable.** `/etc/lamalibre/lamaste/chisel-users` (every agent's tunnel password) is 0640, group `lamaste-chisel`; chisel runs as `nobody` with that group. The panel writes it directly (0600 temp file → group → mode → fsync → rename), so the file chisel reloads never has the wrong permissions; the sudo rules for it are gone.
- **Startup fails closed.** If the panel cannot bring the chisel unit and authfile in line with the tunnel state at startup, it stops and disables chisel — an authfile from an older version grants every agent every port, and a disabled unit keeps a reboot from starting it — and retries in the background (30 s, backing off to 10 min); once it succeeds chisel is enabled and started again.
- **The panel user can no longer become root.** The panel runs as `lamaste`; much of what sudoers let it do was root-equivalent, and all of it is closed:
  - No sudoers rule has a wildcard any more. A sudoers `*` matches spaces, so rules such as `mv /tmp/site-index-* /var/www/lamaste/*`, `find /var/www/lamaste/*`, `cat /etc/authelia/*`, `chown lamaste:lamaste /etc/lamalibre/lamaste/pki/*` and `openssl genrsa -out /etc/lamalibre/lamaste/pki/* *` accepted `-t /etc/sudoers.d`, `-exec`, `/etc/shadow` and `-engine <lib.so>`. The file is now fixed `systemctl` lines, `nginx -t`, and three root-owned programs that validate their arguments: `lamaste-certbot`, `lamaste-cert-info` and the new `/usr/local/sbin/lamaste-priv`.
  - **nginx vhosts are installed by `lamaste-priv`, which accepts only the panel's own site names and only vhosts built from an allow-list of directives.** nginx's master process opens the files a configuration names as root: a vhost with `access_log /etc/cron.d/x` and a crafted `log_format` was a root shell. `root`/`alias` must stay under `/var/www/lamaste`, certificates under `/etc/letsencrypt/live`, `include` is limited to Lamaste's snippets, `proxy_pass` to `127.0.0.1`, `listen` to 443.
  - **Self-update no longer runs a script the panel wrote.** The panel wrote `update-*.sh` into its own config directory and had root run it; `lamaste-priv self-update <version>` now takes only a version and starts `create-lamaste@<version>` itself.
  - **Authelia no longer runs as root.** It runs as the unprivileged `lamaste-authelia` account in a hardened unit; the panel, which writes its configuration, could previously have pointed a root process at any file. The panel reads and writes `/etc/authelia` directly (owned `lamaste:lamaste-authelia`), and stores TOTP secrets through `lamaste-priv`, secret on stdin — it used to be a sudo command-line argument, recorded in the sudo log.
  - **Binaries and units are installed by create-lamaste only.** The panel downloaded chisel and Authelia (Authelia unpinned and unverified, from GitHub's "latest") and wrote their systemd units — `ExecStart=` of its choosing, run by systemd. The installer now installs both pinned releases, verified against SHA-256 digests, and their units; onboarding only starts them.
  - **The code root runs is root-owned.** `/opt/lamalibre/lamaste` (panel, gatekeeper, and the `lamaste-server` CLI administrators run with sudo) belonged to `lamaste`, and the redeploy ran `npm install` as root inside it.
  - **Root never writes through a path the panel controls.** The redeploy, `lamaste-server reset-admin` and the installer write into the panel's directories only as fresh `O_EXCL|O_NOFOLLOW` files renamed into place (ownership set on the descriptor), or run the step as `lamaste`; `lamaste-server plugins install|enable|disable|uninstall` runs npm and the state writes as `lamaste`; temporary directories are unpredictable. A symlink planted by a compromised panel is no longer a way to make root overwrite or chown an arbitrary file.
  - The PKI, static sites and the invitation page need no privileges: the panel owns its CA (plugins receive the CA key's path) and `/var/www/lamaste` (`lamaste:www-data`, setgid directories 2750, files 0640 — nginx reads through the group). The `lamaste-sign-csr` and `lamaste-pki-rename` wrappers are gone; agent CSRs are still refused unless their CN is an agent label.
- **`lamaste-server reset-admin` revokes the old admin certificate again.** It recorded the revocation in `pki/revoked.json`, which nothing has read since revocation moved to the panel's `state.db`, so after a reset the previous admin certificate kept working. It now writes to `revoked_certs` (as the `lamaste` user) and fails loudly if it cannot.
- **Let's Encrypt operations go through root-owned wrappers.** The sudoers rules `certbot certonly --nginx -d * …`, `certbot renew --cert-name * …` and `openssl x509 … -in /etc/letsencrypt/live/*` also matched extra arguments (`--deploy-hook`, `--nginx-ctl`, `-engine`, path traversal) — root code execution for the `lamaste` user. They are replaced by `/usr/local/sbin/lamaste-certbot` and `/usr/local/sbin/lamaste-cert-info`, which validate every hostname and email and run certbot/openssl with a fixed argument vector.
- **Agents verify the relay's TLS certificate and only talk to the relay they enrolled with.** `chiselArgs` no longer contain `--tls-skip-verify` (discarded if an older panel sends it), and an agent refuses a chisel server other than `https://tunnel.<enrolled domain>:443` or a panel reporting another domain. The broken "chisel server cert pin" (`chiselServerCertSha256Hex`) is removed; the agent daemon no longer overwrites the enrolled domain from the panel.
- **The chisel credential is no longer a process argument.** Linux agents read it from a 0600 `EnvironmentFile` (`~/.lamalibre/lamaste/agents/<label>/chisel.env`); macOS agents from the 0600 LaunchAgent plist's environment. Because earlier versions exposed it in `ps` and in a world-readable unit file, an upgraded agent rotates its credential once on its first sync. Agent data directories are 0700.
- **Chisel is pinned.** Server and agents run chisel 1.12.0, downloaded from its fixed release URL and verified against a pinned SHA-256 before it is unpacked (previously: whatever GitHub reported as latest, unverified). Other installed versions are replaced automatically.
- **A revoked agent's tunnels are released.** Its app tunnels become unassigned and its `agent-<label>` panel tunnel is deleted, so a later enrollment that reuses the label inherits nothing.

### Added

- `@lamalibre/lamaste`: `AUTHELIA_RELEASE`, `autheliaAssetUrl`, and the verified-download helpers (`downloadVerifiedChisel`, `downloadVerifiedAuthelia`, `curlDownloadArgs`, `isPinnedChiselVersion`, `normaliseChiselVersion`, `normaliseAutheliaVersion`); `@lamalibre/lamaste/server`: `isAutheliaInstalled`.
- `npm test` runs the `lamaste-priv` allow-list tests and a check that every vhost the panel generates passes it.
- **`lamaste-agent sync` and the sync timer** (systemd user timer / LaunchAgent, every 30 s). Sync converges the local chisel client with the panel: new, deleted, disabled and reassigned tunnels apply within about 30 seconds without `lamaste-agent update`; a rotated chisel credential is fetched; the pinned chisel binary is installed; an agent with no tunnels keeps chisel stopped instead of crash-looping, and starts it once a tunnel is assigned. It logs only changes and new errors (`agents/<label>/logs/sync.log`) and records its last outcome for `lamaste-agent status`. This matters because chisel rejects a client's whole session when a single requested port is not granted: an agent that kept asking for a revoked tunnel lost all of its tunnels.
- Agent-side operations (sync, `update`, `setup`, the agent daemon's start/stop/update, config writes) serialize on a per-agent lock file, so the timer can neither restart a client the operator is stopping nor overwrite a concurrent config change.
- `POST /api/agents/me/chisel-credential/rotate` — an agent replaces its own chisel credential (refused with 429 while the current one is less than 10 minutes old). `GET /api/agents/me/chisel-credential` returns `createdAt`; `agent-config` returns `chiselCredentialIssuedAt`.
- Port 80 redirects to HTTPS: the installer adds a catch-all `lamalibre-lamaste-http-redirect` site (`301 https://$host$request_uri`). Certbot's nginx HTTP-01 challenge and renewals keep working with it (verified on Ubuntu 24.04 with nginx 1.24 and certbot 2.9).
- `PATCH /api/tunnels/:id` accepts `agentLabel` (admin only) to move a tunnel between agents, `accessMode` to change a tunnel's access mode in place, and `maxBodySizeMb`; all fields apply in one workflow.
- Per-tunnel request body limit `maxBodySizeMb` (1–10240 MiB, default 10; agents may set up to 100) rendered as `client_max_body_size`. Tunnels used to inherit nginx's 1 MiB default, rejecting ordinary uploads with 413.
- Static-site `aliases` for custom-domain sites: extra hostnames (typically `www.<domain>`) answered with a 301 to the primary host. One certificate lineage (`--cert-name <fqdn>`) covers every name; DNS verification and live alias changes require each alias to resolve to the server first.
- Admin UI: agent picker and body limit on tunnel creation, an **Agent** and **Body limit** column, an **Edit** dialog (agent, access mode, body limit), and redirect aliases on custom sites.
- `lamaste-server tunnels create --agent <label> [--max-body-mb <n>]`, `tunnels assign <id> --agent <label>`, `tunnels configure <id> [--access-mode] [--max-body-mb]`, `sites create --aliases a,b`, `sites aliases <id> --set a,b`.
- `lamaste-agent setup` and `status` report whether a Linux agent survives reboot (systemd user lingering) and print the fix; the JSON `complete` event carries `bootPersistence`. `status` shows the chisel version and the sync timer's state.
- Agent Setup guide for macOS and Linux (`02-guides/agent-setup.md`), replacing the manual-chisel Mac client guide.

### Changed

- **Onboarding DNS verification checks the names the relay serves.** `POST /api/onboarding/verify-dns` now requires `panel.`, `auth.` and `tunnel.<domain>` to resolve to the server — the names provisioning issues certificates for — instead of the base domain itself. A base domain that another host still serves no longer blocks onboarding; it and the wildcard are reported as optional. The response replaces `resolvedIps` with `records[]` (`name`, `resolvedIps`, `ok`), `apexOk` and `apexResolvedIps`. The cloud provisioner and the desktop wizard say that an existing base-domain record is left alone unless overridden, and what overriding does.

- **Breaking:** admin `POST /api/tunnels` requires `agentLabel` naming an enrolled, non-revoked agent. Agent certificates default to themselves and cannot name another agent; plugin-agent certificates cannot create tunnels (they hold no chisel credential).
- **Breaking:** `chiselArgs` are `['client', <serverUrl>, ...remotes]`. See the upgrade notes.
- **Breaking:** onboarding no longer installs chisel or Authelia; it expects create-lamaste to have installed them (a server that is missing either is told to re-run create-lamaste). Onboarding's first two steps are now titled "Starting Chisel" and "Configuring Authelia" (ids unchanged).
- The chisel server key is generated by the panel (`lamaste:lamaste-chisel`, 0640; earlier `nobody:nogroup` 0400). Startup reconciliation no longer installs chisel or rewrites its unit; it treats chisel as the panel's to run once onboarding is complete, and logs an error if the installed chisel is not the pinned release.
- `POST /api/system/update` answers 500 with the reason if the update cannot be started, instead of 202 followed by a silent failure.
- Invitation usernames must start with a lowercase letter or digit, like every other username.
- **Breaking:** admin `GET /api/tunnels/agent-config` returns only `{domain, chiselServerUrl}` unless `?agent=<label>` names the agent.
- **Breaking:** `lamaste-agent setup` and `update` require a global install (override for unmanaged installs: `LAMALIBRE_LAMASTE_AGENT_CLI_PATH`). `update` now means "converge now and (re)install the sync timer".
- Every tunnel mutation runs under one lock and validates against the state it reads inside it, so two concurrent creates can no longer both take a port. State is written before chisel is synced (the authfile is rendered from persisted state); a chisel failure on create rolls the state back and re-syncs the authfile.
- Chisel reloads its authfile on changes that only add (a new agent, a new grant) and is restarted only when something is revoked (a withdrawn grant, a removed or rotated credential) — `systemctl try-restart`, which leaves a deliberately stopped chisel stopped. Previously every change restarted it. The chisel client reconnects at most 30 s apart (`--max-retry-interval 30s`, down from chisel's 5 min).
- Startup reconciliation binds ownerless tunnels from earlier versions: an agent panel tunnel to the agent its `agent-<label>` hostname names (if active), other tunnels to the sole active agent; with several agents they stay unassigned, are logged, and show as **unassigned** in the panel until moved to an agent.
- Changing a live site's aliases issues its certificate for old and new names first and narrows it to exactly the new names after the vhost is saved, so renewal never has to validate a removed hostname; a failed narrowing is returned as `warning`.
- Agent daemon: stop is remembered and respected by the sync timer; start and restart converge with the panel.
- The chisel client service is generated in one place, `@lamalibre/lamaste/agent` (`chisel-service.ts`, `chisel-credential.ts`, `converge.ts`), for `lamaste-agent` and `lamaste-agentd`. The diverged copies are gone — including agentd's update path, which regenerated the service without the chisel credential.
- Panel-triggered certificate renewals skip certbot's random start delay (up to ~8 minutes).
- Onboarding validates the Let's Encrypt email with the rule the certbot wrapper enforces (`LETSENCRYPT_EMAIL_REGEX`), instead of accepting addresses issuance would later refuse.
- `agent-config` lists only the tunnels chisel grants the agent; a tunnel from older state on a reserved port, or sharing a port with another tunnel, is withheld from everyone and reported at startup instead of making chisel refuse the agent's whole session.
- The sync timer records a Node.js path that survives Node upgrades (e.g. `/opt/homebrew/bin/node`, not the versioned Cellar path), and `lamaste-agent status` flags a timer that has stopped running.
- `lamaste-server` CLI treats HTTP error responses from the panel as failures instead of results.
- A tunnel (and an agent panel tunnel) can no longer claim a hostname that a static site or site alias already serves.

### Removed

- `@lamalibre/lamaste/server`: `installChisel`, `buildChiselUnit`, `writeChiselService`, `ensureChiselService`, `isChiselProvisioned`, `CHISEL_UNIT_PATH`, `installAuthelia`, `writeAutheliaService`, `rotateClientCert` (admin certificates come from `lamaste-server reset-admin` only) and the types `ChiselInstallResult`, `AutheliaInstallResult`, `RotationResult`, `FilesExecFn`. Authelia config, users and static-site file functions no longer take an `exec` argument.
- The sudoers wrappers `lamaste-sign-csr` and `lamaste-pki-rename` (removed from the server on upgrade).

- `GET /api/tunnels/mac-plist`, the admin UI's Mac client plist download, `plist.js`, and the desktop `admin_get_mac_plist` command. The manual plist carried no chisel credential and could not connect since per-agent authentication.
- The unused `writeAppVhost` nginx writer.
- Every wildcard sudoers rule, `systemctl daemon-reload`, and the rules for certbot, Let's Encrypt `openssl` reads and the chisel authfile (see Security).

### Fixed

- The desktop app could not start `lamaste-cloud`, `create-lamaste` or `create-lamaste-admin`: their workspace paths predated the `packages/<group>/<name>` layout, and the fallback handed `node` a bare command name, which it resolves against the working directory instead of PATH. Creating a server, discovering servers and the admin certificate upgrade all failed. The paths are corrected and the fallback locates the globally installed command.

- The redeploy never updated the gatekeeper; it now redeploys it with the rest.
- Adding a site alias (or verifying a custom domain) whose DNS query is refused or fails answered 500; any resolver failure now means "does not resolve here" and gets the 400 with the A record to add.
- E2E: the single-VM suite is current again. Tests written before 2.0 expected panel-side admin certificate rotation and upgrade (refused since B9), `agent:pending` CSRs and un-namespaced plugin capabilities; they now check what the panel does. Fixed alongside: a gatekeeper test assigning bash's read-only `GROUPS`, `jq '.x // empty'` dropping `false`, assertions mistaking a needle that starts with `-` for a grep option, the certbot shim renewing lineages that do not exist, and redirect checks racing nginx's asynchronous reload.
- `create-lamaste` bundles its `vendor/` (panel, CLI, UI, docs, gatekeeper) on every `npm pack` (`prepack`), not only on publish — a locally packed installer, as E2E uses, carried whatever was bundled last.
- `POST /api/certs/agent/enroll-delegated` rejected every ticket scope: it only accepted a two-part `scope:action`, while ticket sub-scopes have been namespaced (`plugin:<name>:<action>`) since 2.0, so no agent could delegate a plugin-agent enrollment.
- E2E: tests that discarded a `multipass exec`'s output (`>/dev/null`) hung until the runner's 10-minute timeout whenever the remote command wrote after a delay — multipass 1.16 on macOS never exits with /dev/null as its stdout or stderr. The shared helpers now give every multipass client pipes.
- `create-lamaste --json --skip-harden` skipped installing nginx, certbot and openssl along with the hardening, so the install failed at "Configuring nginx"; `--skip-harden` now skips only the hardening in both output modes.
- `lamaste-server uninstall` left the chisel and Authelia units, the Authelia binary and log behind.
- `POST /api/services/{chisel,lamalibre-lamaste-serverd}/reload` answers 400 ("use restart"); neither unit supports reload, and the request used to fail inside sudo as a 500.

- Tunnel vhosts dropped `Host`, `X-Real-IP` and `X-Forwarded-*`: nginx ignores server-level `proxy_set_header` in a location that sets its own, and every tunnel location did. Apps saw `Host: 127.0.0.1:<port>`, which breaks absolute redirects and virtual hosting (e.g. GitLab). The headers are now set in each location.
- Rewriting a disabled tunnel's vhost (e.g. changing its body limit) could re-enable it when nginx rejected the new file; the previous file and enabled/disabled state are now restored together.
- The desktop app looked for agent services under the wrong names (`com.lamaste.chisel-<label>`, `lamaste-chisel-<label>`), so it misreported running state and left the tunnel service behind on uninstall. It now uses the names the agent writes and also removes the sync timer.
- The admin UI's tunnel Edit dialog no longer sends a body limit change for a tunnel created before the setting existed when the field was not touched.
- `GET /api/tunnels/agent-config?agent=<malformed>` answers 400, not 500.

## [3.0.0] - 2026-04-29

### Changed

- **Renamed product from Portlama to Lamaste.** v3.0.0 ships the rename across all product-scoped surfaces. The brand-split refactor that landed during the 2.0.0 work-in-progress made this tractable: helpers `productBundleId()` / `productUnit()` / `userProductRoot()` / `etcProductRoot()` (TS `branding.ts`, Rust `branding.rs`) now resolve `PROJECT = 'lamaste'`, cascading through every dynamically-derived identifier. The dated sections below describe work landed during the v3 cycle while the product was still called Portlama; identifiers there reflect the names as they were at the time. The mechanical translation to v3 names: `@lamalibre/portlama-*` → `@lamalibre/lamaste-*`, `com.lamalibre.portlama.*` → `com.lamalibre.lamaste.*`, `lamalibre-portlama-*` → `lamalibre-lamaste-*`, `/etc/lamalibre/portlama/` → `/etc/lamalibre/lamaste/`, `portlama:portlama` (unix user) → `lamaste:lamaste`, `product:portlama` → `product:lamaste`, `LAMALIBRE_PORTLAMA_*` → `LAMALIBRE_LAMASTE_*`, `portlama_2fa_session` → `lamaste_2fa_session`.
  - **NPM packages:** all 20 `@lamalibre/portlama-*` packages renamed to `@lamalibre/lamaste-*`. `@lamalibre/create-portlama{,-agent,-admin,-desktop,-e2e}` → `@lamalibre/create-lamaste-*`. `@lamalibre/portlama-local-plugin-hostd` → `@lamalibre/local-plugin-hostd` (drops product prefix per brand-split rule — the local plugin host is ecosystem-level). All packages aligned to **3.0.0**.
  - **CLI binaries:** `portlama-{agent,server,agentd,serverd,gatekeeper,cloud,reset-admin}` → `lamaste-*`; `portlama-local-plugin-hostd` → `lamalibre-local-plugin-hostd` (ecosystem). Sudoers wrappers `/usr/local/sbin/portlama-{sign-csr,pki-rename}` → `/usr/local/sbin/lamaste-*`.
  - **Unix user/group:** `portlama:portlama` → `lamaste:lamaste`. Sudoers rules, `useradd` arg, systemd `User=`/`Group=`, `chown` calls. `/etc/sudoers.d/portlama` → `/etc/sudoers.d/lamaste`; `/etc/fail2ban/jail.d/portlama.conf` → `/etc/fail2ban/jail.d/lamaste.conf`.
  - **launchd / systemd:** `com.lamalibre.portlama.*` → `com.lamalibre.lamaste.*`; `lamalibre-portlama-*` → `lamalibre-lamaste-*`. Ecosystem labels (`com.lamalibre.local-plugin-host`, `lamalibre-local-plugin-host`) unchanged.
  - **Filesystem paths:** `~/.lamalibre/portlama/` → `~/.lamalibre/lamaste/`; `/etc/lamalibre/portlama/` → `/etc/lamalibre/lamaste/`; `/opt/lamalibre/portlama/` → `/opt/lamalibre/lamaste/`; `/var/www/portlama/` → `/var/www/lamaste/`. Ecosystem paths (`~/.lamalibre/local/`, `/etc/lamalibre/`) unchanged.
  - **Environment variables:** `LAMALIBRE_PORTLAMA_*` (CONFIG, DATA*DIR, PKI_DIR, ENROLLMENT_TOKEN, P12_PASS, …) → `LAMALIBRE_LAMASTE*_`. Ecosystem vars (`LAMALIBRE*CLOUD_TOKEN`, `LAMALIBRE_FERIA_BIN`, `LAMALIBRE_SPACES*_`, `LAMALIBRE_ORG`, `LAMALIBRE_PROJECT`) unchanged.
  - **Tauri:** `productName "Portlama"` → `"Lamaste"`; window title likewise; identifier `com.lamalibre.portlama.desktop` → `com.lamalibre.lamaste.desktop`; cargo crate name `portlama-desktop` → `lamaste-desktop`; bumped to 3.0.0.
  - **2FA cookie:** `portlama_2fa_session` → `lamaste_2fa_session` (no installed base — 2.0.0 unshipped).
  - **DigitalOcean tag:** `product:portlama` → `product:lamaste`. `lamalibre:managed` (ecosystem) unchanged.
  - **DigitalOcean SSH key labels + systemd-run unit names:** `lamalibre-portlama-update-<hex>` → `lamalibre-lamaste-update-<hex>`.
  - **Deep-link query param:** `lamalibre://callback?product=portlama` → `?product=lamaste`. The `lamalibre://` scheme itself is ecosystem-wide; product-tagged callbacks are still single-product today (lamaste is the only product wired into the desktop dispatcher).
  - **nginx file objects:** `lamalibre-portlama-{panel-domain,panel-ip,auth,tunnel,app-<sub>,site-<id>,agent-panel-<sub>,mtls.conf,authz-cache.conf,authz-loc.conf}` → `lamalibre-lamaste-*`.
  - **Code identifiers:** `PORTLAMA_DIR` → `LAMASTE_DIR`; snake_case / camelCase / underscore-bounded `portlama` tokens (`install_portlama`, `portlamaExists`, `portlama_session`, `portlama_authz`, etc.) → `lamaste` equivalents.
  - **Vendor layout under `create-lamaste`:** `vendor/panel-server` → `vendor/serverd`; `vendor/portlama-server` → `vendor/server`; `vendor/portlama-server-ui` → `vendor/server-ui`. Install destinations on the VPS migrate from `/opt/lamalibre/portlama/{panel-server,portlama-server,portlama-server-ui}/` to `/opt/lamalibre/lamaste/{serverd,server,server-ui}/`.
  - **Repo path on GitHub** (`github.com/lamalibre/portlama`) is unchanged here. Renaming the GitHub repo is a separate coordinated action — clones, the desktop's Feria-sibling-discovery walker, and the `lamalibre/plugin-development` sibling repo will be updated together when that lands.
  - **Out of scope (intentionally unchanged):** `RESERVED_API_PREFIXES` (route names like `tunnels`, `agents`, `gatekeeper`); registry filenames (`agents.json`, `servers.json`, `storage-servers.json`); HTTP headers; Tauri event names; capability names — these are namespaced by the package they live in, not by reverse-DNS.

### 2026-04-28

### Changed

- Brand-split rename across all operational identifiers — ecosystem-level surfaces use `lamalibre.*`, product-level (Portlama-specific) surfaces use `lamalibre.portlama.*`. 2.0.0 has not shipped, so this is a breaking rename with zero installed-base impact. NPM package names (`@lamalibre/portlama-*`), reserved API prefixes, capability names, registry filenames (`agents.json`, `servers.json`, `storage-servers.json`), Tauri event names, and HTTP header conventions stay product-scoped and are unaffected.
  - **launchd labels:** `com.portlama.{cloud,storage,local-plugin-host}` → `com.lamalibre.*` (ecosystem); `com.portlama.{server,admin,agent,desktop,agentd,serverd,chisel-<label>,panel-<label>}` → `com.lamalibre.portlama.*` (product).
  - **systemd units:** `portlama-{agentd,serverd,gatekeeper,chisel-<label>,panel-<label>}` → `lamalibre-portlama-*`; `portlama-local-plugin-host` → `lamalibre-local-plugin-host` (ecosystem); legacy `portlama-panel` unit name retired in favour of `lamalibre-portlama-serverd` (matches the package name).
  - **nginx file objects:** `portlama-panel-domain`, `portlama-panel-ip`, `portlama-auth`, `portlama-tunnel`, `portlama-app-<subdomain>`, `portlama-site-<id>`, `portlama-agent-panel-<subdomain>`, `portlama-mtls.conf`, `portlama-authz-cache.conf`, `portlama-authz-loc.conf` → `lamalibre-portlama-*`.
  - **Filesystem paths:** `/etc/portlama/...` → `/etc/lamalibre/portlama/...`; `~/.lamalibre/.portlama/...` → `~/.lamalibre/portlama/...` (de-hide); `~/.lamalibre/.portlama/local/` → `~/.lamalibre/local/` (hoist to ecosystem); `/opt/portlama/` → `/opt/lamalibre/portlama/`; `/etc/portlama/portlama-update-*.sh` → `/etc/lamalibre/portlama/update-*.sh`.
  - **Environment variables:** `PORTLAMA_{CLOUD_TOKEN,SPACES_ACCESS_KEY,SPACES_SECRET_KEY,NODE_BIN,NPM_BIN,FERIA_BIN}` → `LAMALIBRE_*` (ecosystem); `PORTLAMA_{CONFIG,DATA_DIR,PKI_DIR,STATE_DIR,CHISEL_AUTHFILE,CHISEL_KEYFILE,AGENTD_PATH,ENROLLMENT_TOKEN,P12_PASS}` → `LAMALIBRE_PORTLAMA_*` (product).
  - **Deep links:** `portlama://callback?token=…&domain=…` → `lamalibre://callback?product=portlama#token=…&domain=…&nonce=…` — scheme is ecosystem-wide; product is selected by query string and OAuth-style fragment carries the volatile parts.
  - **Cloud tags:** `portlama:managed` (single tag) → `lamalibre:managed` plus `product:portlama` (both required) — disambiguates resources owned by other Lamalibre products on the same DigitalOcean account.
  - **Sudoers temp prefixes:** `/tmp/portlama-authelia-*`, `/tmp/portlama-curl-*`, `/tmp/chisel-*`, `/tmp/portlama-portlama-server-ui-build` → `/tmp/lamalibre-portlama-*` — keeps sudoers `mv` rules narrowly scoped to the new prefix.
  - **Browser globals:** `window.__portlamaPlugins` → `window.__lamalibrePlugins`; `localStorage["portlama-cloud-disclaimer-dismissed"]` → `localStorage["lamalibre.cloud.disclaimer-dismissed"]`.
  - **DigitalOcean SSH key labels:** `portlama-update-<hex>` → `lamalibre-portlama-update-<hex>`.

### 2026-04-04

### Added

- Add Gatekeeper authorization service — generic principal-to-resource grant model with Portlama groups, nginx auth_request integration, and inline access-request pages on 403 (`portlama-gatekeeper` 0.1.0)
- Add three tunnel access modes: `public` (no auth), `authenticated` (Authelia login), `restricted` (Authelia + grant check) — configurable per tunnel at creation time (`panel-server`, `portlama-gatekeeper`)
- Add Gatekeeper admin panel — Dashboard, Groups, Grants, Access Requests, and Settings pages with full CRUD (`portlama-admin-panel`, `portlama-desktop`)
- Add Gatekeeper installer task — deploys package, creates state files, writes systemd service and nginx cache config (`create-portlama`)
- Add Gatekeeper CLI for local group, grant, and access management (`portlama-gatekeeper`)
- Add migration from legacy `user-plugin-access.json` grants to Gatekeeper's generic grant model (`portlama-gatekeeper`)
- Add Gatekeeper concept and API reference documentation (`panel-client`)
- Add server discovery — find existing Portlama-managed DigitalOcean droplets with DNS domain resolution and panel URL detection (`portlama-cloud`, `portlama-desktop`)
- Add SSH-based admin recovery — recover admin access when P12 certificate is lost via ephemeral SSH key pair and `portlama-reset-admin` (`portlama-cloud`, `portlama-desktop`)
- Add Discover Server wizard — desktop UI for discovering existing servers, registering them, and recovering admin certificates via SSH (`portlama-desktop`)
- Add `--json` non-interactive mode to admin certificate upgrade CLI with NDJSON progress output for desktop integration (`install-portlama-admin`)
- Add step-by-step progress reporting to agent uninstall with per-step status (complete/skipped/warning/failed) (`portlama-desktop`)
- Add type-to-confirm safety dialog for agent uninstall requiring the agent label to be typed (`portlama-agent-panel`)
- Add gatekeeper design document for future tunnel access control system (`panel-client`)

### Changed

- Rewrite desktop admin certificate upgrade as thin shell-out to `install-portlama-admin --json` replacing ~250 lines of Rust reimplementation (`portlama-desktop`)
- Move agent uninstall from `commands.rs` to `agents.rs` with per-agent scoping instead of removing the entire `~/.portlama` directory (`portlama-desktop`)

### Fixed

- Fix Keychain identity invisible after admin certificate upgrade — trust the Portlama CA in the login keychain via `security add-trusted-cert` (`install-portlama-admin`)
- Fix macOS curl unable to use Keychain identities — create a P12 file with the upgraded certificate for curl-based tools alongside the non-extractable Keychain import (`install-portlama-admin`)
- Fix `portlama-reset-admin` not restarting panel-server after config change — cached `adminAuthMode` prevented the reset from taking effect (`panel-server`)
- Fix Tauri error messages not displayed in admin and agent panel toasts — normalize plain string errors from `invoke()` via `errorMessage()` helper (`portlama-admin-panel`, `portlama-agent-panel`)
- Fix agent uninstall not navigating back to agent list after completion (`portlama-agent-panel`, `portlama-desktop`)
- Fix domain detection only matching 2-part TLDs — use DigitalOcean zone names for base domain identification (`portlama-cloud`)

### Removed

- Remove `access-control-sync.js` — Authelia access control rule sync replaced by Gatekeeper authorization (`panel-server`)

### Security

- Add shared API secret for Gatekeeper localhost management routes — prevents unsandboxed plugins from manipulating grants directly (`portlama-gatekeeper`, `panel-server`)
- Add fail-closed authorization — Gatekeeper denies access when tunnel is not found or `X-Original-URL` is missing, preventing bypass on empty cache (`portlama-gatekeeper`)
- Add admin-only enforcement for non-restricted tunnel access modes — agents cannot create `public` or `authenticated` tunnels (`panel-server`)
- Add session cache hard cap (10k entries) and Authelia-cookie-only cache key to prevent memory exhaustion and cache pollution on 512MB droplets (`portlama-gatekeeper`)
- Add group member cap (1000 per group) to prevent disk/memory exhaustion via unbounded membership (`portlama-gatekeeper`)
- Add admin role guard to all Gatekeeper proxy routes (`panel-server`)
- Add symlink attack protection to server directory cleanup on server removal (`portlama-desktop`)
- Add path traversal protection to SSH recovery cleanup — canonicalize paths before validation and use canonical path for operations (`portlama-cloud`, `portlama-desktop`)
- Fix TOCTOU in recovery cleanup — pass canonicalized directory path to Node.js CLI instead of original user input (`portlama-desktop`)

### 2026-04-02

### Added

- Add agent-side user plugin access — non-admin Authelia users can access agent-hosted plugins via dedicated tunneled subdomains with per-user access control (`panel-server`, `portlama-agent`, `portlama-desktop`, `portlama-admin-panel`)
- Add `target` field to grants — `'local'` for desktop install (existing), `'agent:<label>'` for browser access to a specific agent's plugin (`panel-server`)
- Add `plugin` tunnel type — Authelia-protected subdomain with nginx path rewriting to route traffic to the correct plugin on an agent's panel server (`panel-server`)
- Add `syncAllAccessControl()` — unified Authelia access control rule builder that merges site rules with plugin tunnel grant rules (`panel-server`)
- Add `Remote-User` header authentication to agent panel server — enables Authelia-authenticated users to access plugin routes via tunneled subdomains (`portlama-agent`)
- Add target selector (Local/Agent) to admin grant creation modal and target column to grant table (`portlama-admin-panel`)
- Add "Open in Browser" button for agent-side grants in desktop My Plugins page (`portlama-desktop`)
- Add user-access grant methods and agents endpoint to web admin client (`panel-client`)

### Security

- Restrict Authelia-authenticated users to plugin routes only — block `/api/*` management endpoints on agent panel server (`portlama-agent`)
- Add `Remote-User` header format validation to prevent header injection attacks (`portlama-agent`)
- Tighten `pluginName` regex to `^@lamalibre\/[a-z0-9][a-z0-9._-]*$` to prevent nginx config injection via crafted package names (`panel-server`)
- Add `pathPrefix` validation in `writeAppVhost()` as defense-in-depth against nginx directive injection (`panel-server`)
- Add admin-only restriction for plugin tunnel creation — agents with `tunnels:write` cannot create plugin tunnels (`panel-server`)
- Add `restrictAccess` flag for plugin tunnel Authelia rules — deny all non-admin access when no grants exist (admins-only by default) (`panel-server`)
- Add Authelia config backup/rollback on restart failure — prevents bricked authentication on config errors (`panel-server`)
- Add hard cap of 200 active grants to prevent Authelia config DoS via unbounded rule growth (`panel-server`)
- Add reserved route prefix validation — block plugin tunnels that would collide with `api`, `plugin-bundles`, or `internal` paths (`panel-server`)
- Return error to admin when Authelia access control sync fails on grant create/revoke instead of silent success (`panel-server`)
- Expand auth requirement to all `/{pluginName}/` routes (not just `/api/` paths) to prevent authentication bypass on non-API plugin routes (`portlama-agent`)

- Add Feria dev registry — local npm registry for `@lamalibre/*` packages with release artifact storage and GitHub Actions workflow runner (`feria`)
- Add Feria-first download fallback to desktop installer — checks local registry before GitHub Releases (`install-portlama-desktop`)
- Add plugin sidebar injection to desktop app — multi-page plugins replace agent tabs with plugin-specific navigation (`portlama-desktop`, `portlama-agent-panel`)
- Export `AgentPluginPanel` component for standalone plugin embedding with `onPagesDiscovered` callback (`portlama-agent-panel`)
- Add Plugins tab to desktop agent mode (`portlama-desktop`)

### Security

- Fix shell injection in desktop installer — replace `execSync` string interpolation with `execFileSync` array arguments in `installMacOS()` (`install-portlama-desktop`)
- Fix path traversal in Feria package store — validate scoped package names and apply `path.basename()` to prevent directory escape (`feria`)
- Fix path traversal in Feria release store — sanitize `tag` and `filename` parameters with `path.basename()` (`feria`)
- Fix host header poisoning in Feria — hardcode `registryUrl` from server config instead of deriving from `Host` header (`feria`)
- Fix over-broad URL decoding in Feria — `rewriteUrl` now only decodes `%2f` instead of full `decodeURIComponent` (`feria`)
- Add HTTPS-to-HTTP redirect downgrade protection in desktop installer (`install-portlama-desktop`)
- Add redirect depth limit (max 5 hops) to prevent infinite redirect loops in desktop installer (`install-portlama-desktop`)
- Fix Content-Disposition header injection in Feria — use strict character allowlist for asset filenames (`feria`)

### Changed

- Update plugin microfrontend theme API to use oklch color values via `HOST_THEME` constant (`portlama-agent-panel`)

**Affected packages:** `@lamalibre/portlama-panel-server` 0.1.30, `@lamalibre/portlama-agent` 1.0.24, `@lamalibre/portlama-admin-panel` 0.1.5, `@lamalibre/portlama-panel-client` 0.1.11, `@lamalibre/portlama-desktop` 0.1.15, `@lamalibre/create-portlama` 1.0.53, `@lamalibre/feria` 0.1.1, `@lamalibre/install-portlama-desktop` 0.0.7, `@lamalibre/portlama-agent-panel` 0.1.3, `@lamalibre/portlama-cloud` 0.1.4, `@lamalibre/portlama-identity` 0.1.1, `@lamalibre/portlama-tickets` 0.1.1

### 2026-04-01

### Added

- Add Authelia login to desktop app — non-admin users authenticate via browser-based OAuth-like flow and install plugins they've been granted access to (`panel-server`, `portlama-desktop`, `portlama-admin-panel`)
- Add "User Plugin Access" admin page for granting per-user, per-plugin enrollment rights (`portlama-admin-panel`, `portlama-desktop`)
- Add user-access API endpoints: grant CRUD (admin), OAuth authorize/exchange flow (public), plugin listing and enrollment (user session) (`panel-server`)
- Add HMAC-SHA256 signed user session tokens with 12h expiry and 2h inactivity timeout, distinct from 2FA sessions via `type: 'user-access'` field (`panel-server`)
- Add `portlama://` deep link scheme for desktop app OAuth callback with domain verification against stored pending login (`portlama-desktop`)
- Add User Login and My Plugins pages to desktop app sidebar (`portlama-desktop`)
- Add `user-access` to reserved API prefixes (`panel-server`, `portlama-agent`)
- Add nginx Authelia forward auth location for `/api/user-access/authorize` on auth vhost and public locations for exchange/plugins/enroll on panel domain vhost (`panel-server`)

### Security

- Add domain validation in desktop user-access login to prevent URL injection via crafted domain strings (`portlama-desktop`)
- Add deep link domain verification — store expected domain before opening browser, reject callbacks with mismatched domains to prevent MITM token theft (`portlama-desktop`)
- Add OTP hard cap (50 active tokens) and rate limiting on all user-access nginx locations to prevent DoS (`panel-server`)
- Fix agent plugin server routes bypassing authentication hook — auth now covers `/<plugin>/api/` routes in addition to `/api/*` (`portlama-agent`)
- Fix grant-to-plugin mismatch — desktop validates that the requested package matches the grant's plugin name before installation (`portlama-desktop`)
- Remove enrollment token from desktop frontend response to reduce credential exposure window (`portlama-desktop`)
- Upgrade OTP timing-safe comparison to use HMAC-digest pattern matching ticket system for defense-in-depth (`panel-server`)
- Add consumed grant cleanup (90-day retention) and stale OTP cleanup to prevent unbounded state file growth (`panel-server`)

- Add agent plugin hosting — agents serve plugins on their panel server (port 9393) with routes at `/<name>/...`, matching local plugin host URL pattern (`portlama-agent`)
- Add agent plugin lifecycle library with install, enable, disable, uninstall, update, and bundle read operations (`portlama-agent`)
- Add plugin CRUD endpoints to agent panel API: list, install, enable, disable, uninstall, update, and bundle serving (`portlama-agent`)
- Add Plugins management page to agent panel with curated plugin list, install form, plugin detail with microfrontend loader, enable/disable toggles, update checking, and uninstall (`portlama-agent-panel`)
- Add "Move to Agent" migration flow in desktop Local Plugins page — copies plugin data, installs on agent, removes local copy (`portlama-desktop`)
- Add `POST /api/agents/plugins/report` endpoint — agents report enabled plugin capabilities to server with persistence across restarts (`panel-server`)
- Add 8 Tauri commands for agent plugin management: get, install, enable, disable, uninstall, update, check-update, fetch bundle with chunked IPC for large bundles (`portlama-desktop`)
- Add `agents` to reserved API prefixes to prevent plugin name collision (`panel-server`, `portlama-agent`)
- Add server-side storage system — AES-256-GCM encrypted credential storage, plugin bindings, and admin API (`panel-server`)
- Add `POST /api/system/update` endpoint for admin-triggered panel self-update via systemd-run (`panel-server`)
- Add CSR-based agent certificate upgrade to hardware-bound via `POST /api/certs/agent/upgrade-cert` (`panel-server`)
- Add enrollment token revocation via `DELETE /api/certs/agent/enroll/:label` (`panel-server`)
- Add `@lamalibre/install-portlama-agent` package for agent cert upgrade to hardware-bound (new)
- Add Storage admin page to panel and admin-panel shared package (`panel-client`, `portlama-admin-panel`)
- Add panel server updater module with SSH-based remote update and health verification (`portlama-cloud`)
- Add panel update commands to desktop app: `check_panel_update`, `update_panel_server` (`portlama-desktop`)
- Add storage-to-panel bridge commands in desktop: `push_storage_to_panel`, `bind_plugin_storage`, `setup_plugin_storage` (`portlama-desktop`)

### Changed

- Refactor agent plugin CLI to delegate to shared `agent-plugins.js` library — CLI is now a thin wrapper (`portlama-agent`)
- Expand systemd `ReadWritePaths` for agent panel service to include agent data directory for plugin runtime state (`portlama-agent`)
- Migrate panel-client pages to portlama-admin-panel shared package — panel-client now consumes pages from the shared library (`panel-client`, `portlama-admin-panel`)
- Replace P12-based agent enrollment with CSR-based token enrollment — agent generates keypair locally, sends CSR with one-time token (`portlama-agent`)
- Remove macOS Keychain identity import from agent CLI — desktop app handles Keychain via Rust crate (`portlama-agent`)
- Enrollment token creation now silently replaces existing active token for the same label instead of returning 409 (`panel-server`)

### Fixed

- Add CORS support to agent panel server for desktop app plugin microfrontends — Tauri and localhost origins with credentials (`portlama-agent`)
- Add localhost-origin mTLS bypass on agent panel server — plugin microfrontend browser fetches no longer require mTLS headers when accessed from the desktop app (`portlama-agent`)
- Fix agent panel `--json` flag not propagated from global CLI flags — `getPanelExposeStatus` returned human-readable text instead of JSON (`portlama-agent`)
- Fix agent plugin routes mounted at wrong prefix — plugins expect `/${name}/...` (matching local plugin host) not `/api/plugins/${name}/...` (`portlama-agent`)
- Fix plugin disable endpoint race condition — `setImmediate` replaced with `setTimeout(500)` to flush HTTP response before panel service restart (`portlama-agent`)
- Fix Tauri IPC crash with large plugin bundles — split JS source into 16KB chunks in Rust, join in JavaScript to avoid WebKit JSON parser limits (`portlama-desktop`)
- Fix CSP blocking plugin microfrontend API calls — add `http://127.0.0.1:*` to `connect-src` and `'unsafe-eval'` to `script-src` (`portlama-desktop`)
- Fix `panel.json` written with mode 0640 instead of 0600 — file contains session secrets (`panel-server`, `create-portlama`)
- Fix missing fsync before rename in config auto-write and updateConfig — crash could corrupt config (`panel-server`)
- Fix CORS `origin: true` on local plugin host reflecting arbitrary origins with credentials — restrict to Tauri and localhost origins (`portlama-agent`)
- Fix sudoers wildcard for self-update allowing potential argument injection — tighten to require `.sh` extension (`create-portlama`)
- Fix missing buffer length validation in `decryptCredential` — corrupted data could cause unpredictable crypto errors (`panel-server`)
- Fix read-only storage operations unnecessarily holding write mutex (`panel-server`)
- Fix update script not cleaned up when systemd-run launch fails (`panel-server`)

### Security

- Tighten sudoers rule for panel self-update: pin `.sh` extension, add descriptive comment about wildcard scope (`create-portlama`)
- Restrict local plugin host CORS to explicit origin allowlist instead of echoing any origin (`portlama-agent`)
- Change `panel.json` file permissions from 0640 to 0600 — contains `sessionSecret` and `panel2fa.secret` (`panel-server`, `create-portlama`)

**Affected packages:** panel-server 0.1.28, panel-client 0.1.10, portlama-agent 1.0.22, portlama-agent-panel 0.1.2, create-portlama 1.0.51, portlama-admin-panel 0.1.3, portlama-cloud 0.1.3, portlama-desktop 0.1.14, install-portlama-agent 1.0.0 (new)

---

### 2026-03-30

### Added

- Add identity system for Authelia user metadata in plugin routes — plugins can identify which Authelia user is making a request through protected subdomains
- Add `@lamalibre/portlama-identity` SDK (v0.1.0) with `parseIdentity()` parser, `IdentityClient` for user/group queries, and Fastify plugin (`@lamalibre/portlama-identity/fastify`)
- Add `identity:read` and `identity:query` agent capabilities for identity header parsing and user metadata queries
- Add `GET /api/identity/self`, `GET /api/identity/users`, `GET /api/identity/users/:username`, `GET /api/identity/groups` panel API endpoints
- Add nginx `Remote-*` header clearing on all vhosts to prevent client-forged identity headers (panel domain, panel IP, app, static site, agent panel, public endpoints)
- Add identity capability toggles to admin certificate management UI
- Add "Create Storage Server" wizard to the desktop app — 3-step flow (Credentials → Configuration → Provisioning) for provisioning DigitalOcean Spaces buckets (`portlama-desktop`)
- Add storage server section to the Servers page with dedicated StorageServerCard component showing bucket details and destroy/remove actions (`portlama-desktop`)
- Add OS keychain storage for Spaces credentials via `com.portlama.storage` service — access key + secret key stored as JSON, never in plaintext (`portlama-desktop`)
- Add 9 Tauri commands for storage server lifecycle: credential management, validation, region listing, provisioning with NDJSON progress, registry CRUD, and destroy (`portlama-desktop`)
- Add `validate-spaces` CLI command for credential validation before provisioning (`portlama-cloud`)
- Add `StorageProvider` interface and DigitalOcean Spaces implementation for provisioning S3-compatible object storage independently from compute servers (`portlama-cloud`)
- Add `provision-storage`, `destroy-storage`, `storage-servers`, and `spaces-regions` CLI commands for storage lifecycle management (`portlama-cloud`)
- Add storage server registry at `~/.portlama/storage-servers.json` with atomic writes (`portlama-cloud`)
- Add minimal AWS Signature V4 signing for S3-compatible APIs using only `node:crypto` — no new dependencies (`portlama-cloud`)
- Extract shared `CleanupStack` from compute provisioner for reuse by both compute and storage provisioners (`portlama-cloud`)

### Changed

- Update E2E test infrastructure to use deterministic static IPs (`10.13.37.0/24`) — eliminates DHCP instability across snapshot restores
- Update E2E agent setup to use enrollment token flow instead of legacy P12 certificate transfer
- Update E2E VM provisioning with tiered snapshot system (node-ready → installed → provisioned) for faster iteration

**Affected packages:** portlama-identity 0.1.0 (new), panel-server 0.1.13, portlama-admin-panel 0.1.2, portlama-desktop 0.1.12, create-portlama 1.0.42, install-portlama-e2e-mcp 0.2.0, portlama-cloud 0.1.3

### Fixed

- Fix agent certificate revocation skipping active certs when a revoked entry with the same label exists in the registry
- Fix rate limiting blocking localhost API calls during rapid test/automation sequences — exempt `127.0.0.1` and `::1` from the global rate limit
- Fix `portlama-agent uninstall` hanging when run without a TTY (e.g. via `multipass exec` or CI) — use simple renderer when no terminal is attached
- Fix DigitalOcean token validation rejecting correctly-scoped tokens — update scope parser to handle both comma-separated and space-separated `X-OAuth-Scopes` header formats (OAuth 2.0 RFC 6749 compatibility)
- Fix stale scope names in dangerous-scope check — `loadbalancer:*` → `load_balancer:*`, `volume:*` → `block_storage:*` per current DO API
- Fix false rejection of tokens with `database:create` — now recognized as a DO-documented associated scope of `droplet:create`

**Affected packages:** panel-server 0.1.13, portlama-agent 1.0.16, portlama-cloud 0.1.2

### Security

- Fix SSRF in agent panel API proxy — validate that all curl targets use `https://` scheme before invocation (`portlama-agent`)
- Fix XSS and open-redirect in onboarding complete page — reject non-`https://` URLs in panel and auth link `href` attributes (`panel-client`)
- Fix clear-text password logging in installer summary and admin reset CLI — reference the password file path instead of printing the password (`create-portlama`, `panel-server`)
- Fix polynomial ReDoS in email validation regex used during cloud provisioning (`portlama-cloud`)
- Fix polynomial ReDoS in trailing-slash normalization for panel URLs and cert paths (`portlama-tickets`, `panel-server`)
- Fix incomplete HTML tag sanitization in documentation page heading ID generation (`panel-client`)
- Add `@fastify/rate-limit` (100 req/min) to panel server, agent panel server, and local plugin host (`panel-server`, `portlama-agent`)
- Add `permissions: contents: read` to CI workflow to follow least-privilege principle

**Affected packages:** panel-server 0.1.12, panel-client 0.1.9, portlama-agent 1.0.14, portlama-tickets 0.1.0, portlama-cloud 0.1.2, create-portlama 1.0.39

### 2026-03-29

### Added

- Add DigitalOcean DNS management to the cloud provisioning wizard — when the API token includes the `domain` resource group, the wizard shows a Domain step where users can select a DO-managed domain (or create a new one) and have A + wildcard A records created automatically after droplet creation
- Add `domains`, `create-domain`, and `domain-records` CLI commands to `portlama-cloud`
- Add `get_cloud_domains` and `create_cloud_domain` Tauri commands for desktop app integration
- Add `setup_dns` provisioning step between `wait_droplet` and `wait_ssh` — creates DNS records and registers them in the cleanup stack for rollback on failure
- Add standalone local plugin installation via the desktop app — install and manage `@lamalibre/` plugins directly on the local machine without requiring a server or agent
- Add "Local Plugins" sidebar section visible in both Agents and Servers modes in the desktop app
- Add local plugin host Fastify server on `127.0.0.1:9293` — mounts enabled plugin server routes and serves panel bundles, managed as a launchd/systemd user-level service
- Add curated plugin browser (Herd, Shell, Sync, Gate) with install, enable, disable, uninstall lifecycle
- Add plugin panel rendering via microfrontend loader for locally-installed plugins
- Add `modes` field to `portlama-plugin.json` manifest schema — plugins declare support for `server`, `agent`, and/or `local` execution modes (defaults to `['server', 'agent']`)
- Add bearer token authentication and Host header validation (DNS rebinding protection) to the local plugin host
- Add `local_plugins.rs` Tauri module with 11 commands for local plugin management from the desktop app

- Add agent web panel expose feature — agents can serve their management panel at `agent-<label>.<domain>` via a tunnelled mTLS-protected subdomain
- Add `panel:expose` capability for agent certificates — admin grants per-agent permission to expose the panel
- Add `POST /api/tunnels/expose-panel`, `DELETE /api/tunnels/retract-panel`, `GET /api/tunnels/agent-panel-status` endpoints for panel tunnel lifecycle
- Add `type` field to tunnel records (`app` or `panel`) with `agent-` subdomain prefix reserved for panel tunnels
- Add mTLS nginx vhost for panel tunnels — uses client certificate verification instead of Authelia forward auth
- Add agent panel Fastify HTTP server (`panel-server.js`) serving the SPA and REST API on `localhost:9393`
- Add independent panel system service (`com.portlama.panel-<label>` on macOS, `portlama-panel-<label>` on Linux) so the panel survives agent restarts
- Add `portlama-agent panel` CLI command with `--enable [--port 9393]`, `--disable`, and `--status [--json]` modes
- Add web agent client (`createWebAgentClient()`) — HTTP-based `AgentClient` implementation for the web SPA
- Add web panel expose toggle in agent panel Settings page with status indicator and URL display
- Add Tauri commands `get_panel_expose_status` and `toggle_panel_expose` for desktop app integration
- Add `build` script to `create-portlama` that runs `bundle-vendor.js`, keeping bundled panel-server in sync with source
- Add E2E tests for panel expose in both single-VM (19-panel-expose.sh) and three-VM (15-panel-expose.sh) suites
- Add in-app agent installation wizard to desktop app — guides users through server selection, enrollment token generation, and real-time setup progress
- Add DNS record override option in the cloud provisioning Domain step — detects existing A/wildcard records with conflicting IPs and offers an override checkbox to update them in place
- Add `get_cloud_domain_records` Tauri command and `doPut` API helper for fetching and updating DigitalOcean DNS records
- Add full server-side onboarding completion to the cloud provisioner — after droplet creation, automatically runs domain setup, DNS verification, and provisioning via mTLS-authenticated SSH curl through nginx (port 9292)
- Add `domain` field to `ServerEntry` in both TypeScript and Rust — persists the configured domain in the local server registry
- Add two-step server destroy confirmation in desktop app — inline Yes/No prompt followed by a type-to-confirm modal requiring the exact server label

### Changed

- Replace Agents/Servers mode toggle in desktop app sidebar with unified section layout — AGENTS, SERVERS, and LOCAL sections are always visible, agents and servers listed inline with status indicators, drill-down expands sub-navigation within each section
- Move Overview from a wizard tab to a scrollable popup screen in the cloud provisioning wizard, freeing horizontal space for remaining steps
- Add `--json` global flag to `portlama-agent setup` for NDJSON progress output (desktop app integration)
- Add `install_agent` Tauri command — checks Node.js, installs CLI via npm, streams NDJSON progress as `agent-install-progress` events
- Add "Install Agent" button to Agents page empty state and "Add Agent" header button for existing agents
- Add E2E tests for agent JSON setup in both single-VM (20-agent-json-setup.sh) and three-VM (16-agent-json-setup.sh) suites
  - Single-VM suite passed; three-VM suite needs a clean re-run (orchestrator interrupted during cleanup)

- Add `@lamalibre/portlama-agent-panel` shared package — extract agent-mode pages (Dashboard, Tunnels, Services, Logs, Settings) into a host-agnostic React library with `AgentClientContext` abstraction
- Add `createDesktopAgentClient(label)` factory in the desktop app — Tauri-backed implementation of the `AgentClient` interface with multi-agent label binding
- Add URL scheme validation on all `openExternal` calls — only HTTP(S) URLs accepted
- Add cross-agent cache isolation — agent query data is cleared when switching between agents
- Add `--json` flag to `create-portlama` installer for NDJSON progress output, enabling programmatic consumption by desktop and CI tools
- Add local server installation from the desktop app — install Portlama directly on the local Linux machine via `pkexec` privilege escalation
- Add "Install on This Machine" option to the Servers page dropdown (disabled on macOS with "Linux only" indicator)
- Add `LocalInstallWizard` component with overview, progress streaming, and completion steps
- Add existing installation detection and import — register a pre-existing `/etc/portlama/` installation without reinstalling
- Add E2E tests for `--json` installer output in both single-VM and three-VM suites

### Changed

- Update desktop app to consume agent pages from `@lamalibre/portlama-agent-panel` instead of local page components
- Namespace all agent-panel React Query keys with `['agent', ...]` prefix to prevent collisions with admin-panel queries

### Fixed

- Fix dashboard memory readout showing inflated values on Linux — use `mem.active` / `mem.available` instead of `mem.used` / `mem.free` from `systeminformation`, which incorrectly included kernel buffers and disk cache
- Fix server health check returning offline for mTLS-protected servers — attach admin P12 certificate to the health check curl request
- Fix cleanup spinner not stopping after successful provisioning in the cloud wizard
- Remove white background from desktop app dock icon — icon now renders with transparency on macOS

### Security

- Fix shell injection vector in provisioner SSH curl command — domain and email values are now base64-encoded before shell interpolation, preventing command injection via crafted domain names
- Add server-side input validation for domain names, subdomains, and emails in the provisioner — validates format with strict regexes before any use
- Add pagination hard cap (MAX_PAGES=10) to DNS list functions to prevent unbounded memory consumption
- Validate tunnel UUID parameters with regex before URL interpolation in agent panel API proxy routes
- Enforce `panel:expose` capability on PATCH and DELETE operations for panel-type tunnels
- Prevent cross-agent panel tunnel spoofing — agents can only create panel tunnels matching their own certificate label
- Strip sensitive fields from agent panel config endpoint — return `hasCertificate` boolean instead of filesystem paths
- Restrict panel server port to unprivileged range (1024-65535)
- Validate panel server mTLS CN strictly — accept only `agent:<label>` or `admin` (not any non-agent cert)
- Use constant-memory log reading (`tail -n 200`) instead of unbounded `readFile` to prevent OOM on 512MB droplets
- Pass enrollment token via `PORTLAMA_ENROLLMENT_TOKEN` env var in desktop agent install — never exposed in process args
- Validate `panel_url` scheme (`https://` required) in `install_agent` Tauri command to prevent SSRF via `file://` or other protocols
- Add concurrency guard on `install_agent` — prevents race conditions from concurrent installations for the same label
- Use `npm install --ignore-scripts` when installing agent CLI from desktop app
- Validate NDJSON-supplied file paths against `/etc/portlama/pki/` prefix with symlink resolution to prevent path traversal
- Use `libc::getuid()` for privilege operations instead of the `$USER` environment variable
- Gate `CARGO_MANIFEST_DIR` dev paths to debug builds only to avoid leaking developer filesystem layout in release binaries
- Bound NDJSON line reads to 64 KB to prevent memory exhaustion from a misbehaving child process
- Inherit stderr from child process to avoid pipe deadlock on verbose installations

**Affected packages:**

- `@lamalibre/portlama-cloud`: 0.1.1 → 0.1.2
- `@lamalibre/portlama-panel-server`: 0.1.10 → 0.1.12
- `@lamalibre/portlama-panel-client`: 0.1.8 → 0.1.9
- `@lamalibre/portlama-agent`: 1.0.11 → 1.0.14
- `@lamalibre/portlama-agent-panel`: 0.1.0 → 0.1.1
- `@lamalibre/portlama-admin-panel`: 0.1.0 → 0.1.1
- `@lamalibre/portlama-desktop`: 0.1.6 → 0.1.12
- `@lamalibre/create-portlama`: 1.0.35 → 1.0.38

### 2026-03-28

### Added

- Add multi-agent support — configure multiple agents pointing to different Portlama servers, each with isolated config, certs, logs, and plugins at `~/.portlama/agents/<label>/`
- Add `list` command to show all configured agents with connection status
- Add `switch <label>` command to change the default agent
- Add `--label` global flag to target a specific agent from any command
- Add `plugin` command for local agent plugin management (install, uninstall, update, status)
- Add `uninstall --all` with confirmation prompt to remove all agents and `~/.portlama`
- Add Agents landing page in desktop app — list all agents with start/stop controls and per-agent drill-down into Dashboard, Tunnels, Logs, and Settings
- Add `agents.rs` Tauri module — agent registry management with start/stop/restart/logs/tunnels/config commands
- Add automatic migration from single-agent (`agent.json`) to multi-agent registry with legacy file cleanup
- Add `upsertAgent` registry helper — idempotent add-or-update for agent entries
- Add dual-mode desktop app — sidebar toggle switches between Agents (local agent management) and Servers (per-server admin panel with drill-down from server list)
- Add `@lamalibre/portlama-admin-panel` shared React package — admin UI pages, `AdminClientContext` abstraction, and components consumed by both web panel and desktop app
- Add per-server admin panel in desktop app — Dashboard, Tunnels, Services, Static Sites, Users, Certificates, Tickets, Plugins, and Settings pages via `portlama-admin-panel`
- Add "Manage" button on server cards — drills into that server's admin panel with back navigation to server list
- Add admin certificate detection and import — cloud-provisioned servers auto-detected, manual P12 import for agent-setup servers
- Add 2FA session support in desktop app — TOTP verification modal with in-memory session cookie storage (12h expiry)
- Add admin log streaming via HTTP polling — `admin_start_log_stream`/`admin_stop_log_stream` Tauri commands with per-service event filtering
- Add 50+ Tauri admin commands bridging desktop UI to panel-server API via admin mTLS (users, sites, certs, services, tickets, plugins, tunnels)
- Add `AdminClientContext` data client implementations — web via `apiFetch()`, desktop via Tauri `invoke()`
- Add cloud provisioning via DigitalOcean — create, monitor, and destroy servers directly from the desktop app without SSH or terminal commands
- Add `@lamalibre/portlama-cloud` package — cloud provider abstraction with DigitalOcean implementation, token scope validation, SSH provisioning, and NDJSON progress protocol
- Add Create Server wizard with 6-step flow: Overview → Token → Region → Size → Label → Create
- Add droplet size selection — curated list of Basic tier sizes filtered by region, with 512MB ($4/mo) as recommended default
- Add region latency probing via DigitalOcean Spaces endpoints (replaces decommissioned `speedtest-*.digitalocean.com`)
- Add token scope validation with dangerous-scope rejection — tokens with `database:delete`, `kubernetes:create`, etc. are blocked
- Add probe-based validation fallback when `account:read` scope is absent
- Add Overview/disclaimer step with risks, security measures, DO team isolation recommendation, documentation links, and "do not show again" persistence
- Add onboarding domain and email fields to the wizard — optionally sets domain on the panel during provisioning
- Add real-time provisioning progress with braille spinner and running command display in the wizard
- Add `provision-progress` Tauri event for live step-by-step progress updates from Rust backend to React frontend
- Add multi-server management — register, switch, health-monitor, and destroy servers from the Servers tab
- Add "Add Existing Server" flow for manually provisioned servers
- Add OS credential storage module — macOS Keychain (`security-framework` crate) and Linux libsecret (`secret-tool`) for API tokens and P12 passwords
- Add server registry at `~/.portlama/servers.json` with atomic writes and `load_effective_config()` fallback from active server to legacy `agent.json`
- Add cloud provisioning guide with step-by-step DO token setup, team isolation recommendation, and troubleshooting reference
- Add state-colored tray icon — green (connected), red (disconnected), amber (checking), gray (not configured)
- Add `set_tray_state` Tauri command for frontend-driven tray icon updates synced with connection status

### Changed

- Update `load_effective_config()` to three-tier priority: `agents.json` → `servers.json` → `agent.json`
- Update per-agent service names to include label: `portlama-chisel-<label>` (plist/systemd)
- Update per-agent plugin state to `~/.portlama/agents/<label>/plugins.json` and `plugins/` directories
- Extract admin pages from `panel-client` into shared `portlama-admin-panel` package — web panel now imports from the shared package
- Update desktop app server list from agent-only tab to Servers mode landing page with drill-down navigation
- Update desktop sidebar to show mode-contextual navigation — agent tabs, server list, or per-server admin tabs

### Fixed

- Fix `launchctl list` PID parsing — use exact column match instead of substring to prevent false positives between agents with similar labels
- Fix `storeEnrolledCert` receiving enrollment CN instead of local agent label, causing writes to wrong directory
- Fix `loadRegistry` silently swallowing JSON parse errors — now only returns null for missing file, throws on corruption
- Fix `saveRegistry` and `saveAgentConfig` missing `fsync` before rename — prevents data loss on power failure
- Fix agent log directories created with world-readable 0o755 instead of 0o700
- Fix `uninstallLegacy` not unloading the running agent before removing files

### Security

- Add path traversal validation on agent labels and server IDs in Rust filesystem operations
- Add cookie value allowlist validation before passing 2FA session cookies to curl
- Add file upload path validation — rejects symlinks, non-regular files, and curl metacharacters
- Add response body truncation in error messages — prevents server internals leaking to UI (max 200 chars, UTF-8 boundary safe)
- Add service action allowlist — only `start`, `stop`, `restart` accepted by `admin_service_action`
- Add max concurrent log stream limit (5) to prevent resource exhaustion
- Add `files` field to `portlama-admin-panel` package.json to prevent artifact leakage on npm publish

### Changed

- Update app icon to llama-only silhouette on transparent background (removed white square and "CODELAMA" text)
- Update tray icon to match new llama silhouette
- Remove duplicate tray icon caused by both `tauri.conf.json` and `tray.rs` creating separate instances
- Update documentation across 10+ files for cloud provisioning, multi-server support, and credential storage

### Security

- Add token scope validation — reject overly broad DO tokens, require minimum 5 resource groups (account, droplet, regions, ssh_key, tag)
- Add `portlama:managed` tag safety check — refuse to destroy droplets without the tag
- Add credential storage via OS keychain — tokens and P12 passwords never stored in plaintext files or passed as CLI arguments
- Add temporary SSH key lifecycle — ed25519 keypair generated per provisioning session, securely deleted after use
- Add cloud-init wait before apt operations — prevents cache corruption from concurrent background processes on fresh droplets
- Add panel health check via SSH before certificate enrollment — bypasses nginx mTLS requirement on `/api/` routes

**Affected packages:**

- `@lamalibre/portlama-admin-panel` 0.1.0 (new package)
- `@lamalibre/portlama-desktop` 0.1.3 → 0.1.6
- `@lamalibre/portlama-panel-client` 0.1.8 → 0.1.9
- `@lamalibre/portlama-cloud` 0.1.0 → 0.1.1
- `@lamalibre/create-portlama` 1.0.34 → 1.0.35

### 2026-03-26

### Added

- Add ticket system for agent-to-agent authorization — scopes, instances, assignments, tickets, and sessions
- Add Tickets management page in panel UI with tabs for scopes, instances, assignments, tickets, and sessions
- Add ticket API endpoints: scope CRUD, instance registration/heartbeat/deregister, assignment management, ticket request/validate/inbox, session lifecycle
- Add instance liveness tracking with automatic cleanup — active → stale (5 min) → dead (1 hr)
- Add agent panel-api functions for ticket operations (scope registration, instance management, ticket request/validate, session lifecycle)
- Add `@lamalibre/portlama-tickets` TypeScript SDK for client-side ticket lifecycle — `TicketClient`, `TicketInstanceManager` (source side), `TicketSessionManager` (target side)
- Add instance deregistration on SDK shutdown — `TicketInstanceManager.stop()` calls `DELETE /api/tickets/instances/:id` for immediate cleanup
- Add `certbot renew` force-renewal option — `renewCert(domain, { forceRenewal: true })` in certbot library

### Changed

- Extract reserved API prefixes into shared `constants.js` module — single source of truth for plugin and ticket scope name validation
- Use `renewCert()` library function in cert renewal route instead of raw `execa` call
- Add `--non-interactive` flag to `certbot certificates` invocations

### Security

- Constrain sudoers `openssl pkcs12 -export` rule to `-out /etc/portlama/pki/*` with required encryption flags — prevents arbitrary file writes
- Narrow sudoers `authelia storage *` to `authelia storage user totp generate *` — limits to the single subcommand actually used
- Add `--ignore-scripts` to `npm install --production` in installer and redeploy — blocks postinstall script execution from dependencies
- Add `enroll` to plugin reserved names — prevents plugin from shadowing the public enrollment endpoint
- Add `tickets` and `settings` to plugin reserved display labels — prevents sidebar navigation confusion
- Add self-ticket rejection — source agent cannot issue tickets targeting itself
- Add rate limit interval cleanup on graceful shutdown
- Replace raw `timingSafeEqual` with HMAC-SHA256 comparison — eliminates length-leak side channel using per-process random key and fixed-length digests
- Generate session IDs server-side via `crypto.randomBytes(16)` — prevents client-chosen ID collisions
- Enforce server-side `lastActivityAt` timestamps — prevents clients from extending session lifetime
- Add host validation on `transport.direct.host` — rejects private IPs, loopback, link-local, and cloud metadata endpoints (SSRF prevention)
- Tighten sudoers `mv` rules with specific temp-file prefixes — `portlama-authelia-*` for authelia configs, `chisel-*` for chisel binary (was `chisel_*`), remove dead `portlama-service-*` and `portlama-pki-*` rules
- Remove certbot stderr from HTTP error responses in cert renewal endpoint — details logged server-side only

**Affected packages:**

- `@lamalibre/create-portlama` 1.0.32 → 1.0.34
- `@lamalibre/portlama-panel-server` 0.1.8 → 0.1.10
- `@lamalibre/portlama-panel-client` 0.1.6 → 0.1.8
- `@lamalibre/portlama-agent` 1.0.8 → 1.0.10
- `@lamalibre/portlama-tickets` 0.1.0 (new package)

### 2026-03-25

### Added

- Add Linux (Ubuntu) support to portlama-agent — systemd service management alongside existing macOS launchd support
- Add platform-agnostic `GET /api/tunnels/agent-config` endpoint returning Chisel args, domain, and tunnel metadata for any platform
- Add `service-config.js` module that generates plist (macOS) or systemd unit (Linux) from the same Chisel args
- Add `service.js` unified service management abstraction dispatching to launchctl (macOS) or systemctl (Linux)
- Add `cert-store.js` portable certificate storage — macOS Keychain (non-extractable) or Linux P12 file (mode 0600)
- Add `PORTLAMA_ENROLLMENT_TOKEN` environment variable for token-based setup to avoid token exposure in process listings
- Add `chisel-args.js` shared module on panel-server, extracting Chisel argument construction from plist generation for reuse
- Add opt-in TOTP two-factor authentication for admin panel — setup, confirm, verify, and disable via Settings API
- Add Settings page in panel UI with 2FA enable/disable toggle, QR code display, and verification modal
- Add `twofa-session` Fastify middleware — runs after mTLS, before roleGuard, enforces 2FA session for admin cert holders
- Add HMAC-SHA256 signed session cookie (`portlama_2fa_session`) with 12h absolute / 2h inactivity expiry
- Add TOTP replay protection and +/-1 step drift window (RFC 6238, SHA-1, 30s period)
- Add rate limiting on 2FA verify endpoint — 5 attempts per 2 minutes per IP, 5-minute ban

### Changed

- Update agent description from "Mac agent" to cross-platform "tunnel agent for Portlama"
- Update all agent commands (`setup`, `update`, `status`, `uninstall`) to use platform-agnostic service and config abstractions
- Update `fetchPlist` → `fetchAgentConfig` in agent panel-api module, consuming the new platform-agnostic endpoint
- Update agent setup to detect platform and branch to Keychain import (macOS) or P12 file storage (Linux)
- Update E2E test scripts and orchestrator for Linux agent provisioning
- Update `portlama-reset-admin` CLI to clear 2FA state and re-enable IP vhost on recovery

### Security

- Add Chisel argument validation in `service-config.js` — rejects control characters, enforces `127.0.0.1`-only tunnel bindings to prevent pivoting via compromised panel response
- Add IP:9292 vhost auto-disable when 2FA is enabled — forces domain-only access to prevent certificate-only bypass
- Add agent cert (CN=agent:\*) bypass for 2FA — agents never need a session cookie, only admin cert holders are challenged

**Affected packages:**

- `@lamalibre/create-portlama` 1.0.31 → 1.0.32
- `@lamalibre/portlama-panel-server` 0.1.6 → 0.1.8
- `@lamalibre/portlama-panel-client` 0.1.4 → 0.1.6
- `@lamalibre/install-portlama-e2e-mcp` 0.1.3 → 0.1.4
- `@lamalibre/portlama-agent` 1.0.7 → 1.0.8

### 2026-03-24

### Added

- Add multi-page plugin manifest support — plugins can declare multiple panel pages with per-page icons and titles, rendered as grouped sidebar entries
- Add `displayName` field to plugin manifest for human-friendly sidebar section headers
- Add `config` field to plugin manifest for declarative plugin configuration schemas (type, default, enum, description)
- Add nested capabilities format (`{ agent: [...] }`) alongside existing flat array, normalized to flat array internally
- Add `apiPrefix` field to multi-page plugin manifest for declaring the plugin's API route prefix
- Update `/run-e2e` skill to use MCP E2E tools (`mcp__e2e__*`) as preferred method with orchestrate.sh as fallback

### Changed

- Update plugin management UI to show `displayName` as primary label with package name as subtitle
- Update plugin management UI to show page count for multi-page plugins

### Removed

- Remove built-in shell (remote tmux) feature — extracted to standalone plugin at `@lamalibre/shell`
- Remove `shell-server`, `shell`, `shell-log`, and `cp` commands from portlama-agent CLI
- Remove all `/api/shell/*` endpoints (12 REST + 2 WebSocket) from panel-server
- Remove Shell tab and Tauri shell commands from desktop app
- Remove `shell` from plugin RESERVED_NAMES to allow shell plugin registration

### Security

- Add path regex constraint on plugin page paths (`/^\/[a-z0-9-/]*$/`) to prevent route traversal
- Add config key regex constraint (`/^[a-zA-Z][a-zA-Z0-9_-]*$/`) to prevent prototype pollution via `__proto__` or `constructor` keys
- Add config default type validation — default value must match declared type
- Add config record size limits (max 50 keys, max 100 enum values per key) to prevent registry bloat on 512MB droplets
- Add `displayName` reserved label check — rejects names matching core navigation items (Dashboard, Tunnels, etc.)
- Add `displayName` printable ASCII constraint to prevent Unicode control character UI spoofing
- Add `apiPrefix` enforcement — must match `/api/{pluginName}` to prevent core route shadowing
- Add pages array bounds (max 50 pages) and uniqueness constraint on page paths within a plugin
- Add `Object.hasOwn()` guard on sidebar icon resolution to prevent prototype chain lookups

### 2026-03-23

### Added

- Add MCP server for E2E test infrastructure with 19 tools: VM lifecycle, snapshots, provisioning, test execution with dependency resolution, and two-tier logging
- Add npx installer (`npx @lamalibre/install-portlama-e2e-mcp`) that auto-registers the MCP server with Claude Code via `claude mcp add`
- Add VM resource profiles (production/development/performance) matching real deployment tiers
- Add snapshot checkpoint system for fast VM state restore between test iterations
- Add hot-reload tool for re-deploying individual packages to VMs without full reprovisioning
- Add test dependency graph so individual tests can run with automatic prerequisite resolution
- Add auto-discovery of test files from filesystem with git-tracked allowlist — only committed scripts matching `NN-name.sh` are executable
- Add hardware-bound certificate enrollment for agents — private keys generated in macOS Keychain as non-extractable, enrolled via one-time tokens and CSR signing
- Add `POST /api/certs/agent/enroll` admin endpoint to generate enrollment tokens (10-minute expiry, single-use)
- Add `POST /api/enroll` public endpoint for agents to enroll with token + CSR (no mTLS required)
- Add `portlama-agent setup --token <token> --panel-url <url>` for hardware-bound agent enrollment
- Add admin hardware-bound certificate upgrade via `POST /api/certs/admin/upgrade-to-hardware-bound`
- Add `GET /api/certs/admin/auth-mode` endpoint to check admin authentication mode
- Add `portlama-reset-admin` CLI tool for emergency admin cert recovery (root-only, server console)
- Add `@lamalibre/install-portlama-admin` package for admin hardware-bound certificate upgrade via npx
- Add enrollment method badge (P12 / Hardware-Bound) to agent certificate list in panel UI
- Add "Enrollment Token" button to panel UI with token display, copy, and setup command
- Add `enrollmentMethod` field to agent registry and certificate list API response
- Add nginx rate limiting on public `/api/enroll` endpoint (5 requests/minute per IP)

### Changed

- Update nginx mTLS snippet to `ssl_verify_client optional` with per-location enforcement, enabling public endpoints alongside mTLS-protected routes
- Update all agent CLI commands to support both P12 and Keychain authentication via config object dispatch
- Update Tauri desktop app config and API layer to support optional P12 fields and Keychain identity
- Hide P12 download button for hardware-bound agents in panel UI
- Block P12 download and rotation with 410 Gone when admin uses hardware-bound authentication

### Security

- Add domain parameter validation (regex) in E2E MCP to prevent shell injection in provisioning commands
- Add path traversal protection on E2E MCP log and test result file reads
- Add snapshot name validation in E2E MCP to prevent argument injection
- Add restricted file permissions (0o700 dir, 0o600 files) for E2E MCP state files containing credentials
- Add P12 password transfer via file in E2E MCP instead of command-line arguments to prevent process listing exposure
- Add explicit environment variable allowlist in E2E MCP for child processes instead of forwarding full `process.env`
- Add git-tracked file allowlist for test script execution — untracked or injected `.sh` files are rejected
- Add timing-safe token comparison (`crypto.timingSafeEqual`) for enrollment tokens on public endpoint
- Add mutex (`withTokenLock`) to serialize token creation and consumption, preventing TOCTOU races
- Add CSR structural validation (`openssl req -verify`) before signing in both agent and admin paths
- Add CSR size limit (8192 bytes) to prevent resource exhaustion on the public enrollment endpoint
- Add enrollment token file permissions (`mode: 0o600`) and agent registry permissions (`mode: 0o640`)
- Add label re-validation in CSR signing as defense-in-depth against DN injection
- Add error message sanitization on public enrollment endpoint (5xx errors return generic message)
- Add keychain auth guard for shell commands with clear error message instead of crash

**Affected packages:**

- `@lamalibre/create-portlama` 1.0.27 → 1.0.28
- `@lamalibre/portlama-panel-server` 0.1.3 → 0.1.4
- `@lamalibre/portlama-panel-client` 0.1.2 → 0.1.3
- `@lamalibre/portlama-agent` 1.0.5 → 1.0.6
- `@lamalibre/portlama-desktop` 0.1.2 → 0.1.3
- `@lamalibre/install-portlama-admin` — → 1.0.0 (new)
- `@lamalibre/install-portlama-e2e-mcp` — → 0.1.0 (new)

### 2026-03-22

### Added

- Add plugin system with install, uninstall, enable, and disable lifecycle — plugins are `@lamalibre/`-scoped npm packages with a `portlama-plugin.json` manifest
- Add plugin server-side route mounting with two-level Fastify encapsulation — auth guard on outer scope prevents plugins from overriding access control
- Add plugin panel micro-frontend loader — plugins can ship a `panel.js` bundle rendered in the Plugins page
- Add dynamic capability registration — plugins declare capabilities in their manifest, which are merged with base capabilities for agent certificate scoping
- Add push install system for remote plugin management — admin enables a time-windowed push install session per agent, then sends install/update/uninstall commands
- Add push install policies with IP allow/deny lists, allowed plugins, and allowed actions
- Add push install session audit log with configurable retention (default 500 entries)
- Add `portlama-agent plugin` CLI commands: install, uninstall, update, list, and remote push-install polling
- Add Plugins page in the desktop app with install, uninstall, enable, disable, and push install management
- Add Plugins tab to the panel sidebar

### Changed

- Update agent certificate capabilities to support dynamic plugin-declared capabilities
- Update `GET /api/certs/agent` to return only currently valid capabilities (filtering against base + plugin set)

### Security

- Add `@lamalibre/` npm scope enforcement on all plugin install paths — server, agent, push install policies, and agent uninstall/update operations
- Add `--ignore-scripts` flag on all plugin `npm install` calls to block postinstall script execution
- Add reserved plugin name validation — names matching core API prefixes (`tunnels`, `plugins`, `health`, etc.) are rejected at install time
- Add `@lamalibre/` scope check on server module loading path as defense-in-depth against registry file tampering
- Add agent-side manifest name validation (`/^[a-z0-9-]+$/`) to prevent path traversal via malicious plugin names
- Add disabled-plugin route guard with 5-second TTL cache — disabled plugins return 503 without server restart
- Add `ScopedPackageSchema` validation on push install policy `allowedPlugins` field

- Add service discovery & marketplace UI in the desktop app — auto-detects 17 well-known local services (Ollama, ComfyUI, LM Studio, PostgreSQL, Redis, Docker containers, etc.) with one-click tunnel creation
- Add custom service definitions — users can register their own services with name, port, binary, process name, and category, persisted in `~/.portlama/services.json`
- Add Services tab in the desktop sidebar with category filtering (AI, Database, Docker, Dev, Media, Monitoring, Custom)
- Add shared `api.rs` module in the desktop app — extracted curl helpers from `commands.rs` for reuse across the Rust backend
- Add `@lamalibre/install-portlama-desktop` npx installer — downloads, caches, and installs the desktop app from GitHub Releases for macOS (arm64/x64) and Linux (x64)
- Add GitHub Actions workflow for desktop releases — manual trigger via `workflow_dispatch`, builds for macOS arm64, macOS x64, and Linux x64
- Add file type allowlist for static site uploads — only safe web assets (HTML, CSS, JS, images, fonts, media, documents, data, WASM) are accepted; server rejects disallowed extensions with 400
- Add ClamAV malware scanning via Docker in `portlama-agent deploy` — scans files before upload, aborts on infections, warns if Docker is unavailable
- Add extension allowlist check in `portlama-agent deploy` — aborts with listing if blocked files are found
- Add `sites:read` and `sites:write` agent capabilities for static site file management
- Add per-site scoping via `allowedSites` on agent certificates — agents can only see and modify files on sites explicitly assigned to them
- Add `PATCH /api/certs/agent/:label/allowed-sites` endpoint for managing agent site access
- Add site access UI in panel certificate management — assign sites to agents via checkboxes
- Add `portlama-agent sites` command to list, create, and delete static sites from the CLI
- Add `portlama-agent deploy <site> <path>` command to deploy a local directory to a static site
- Add Zod validation on file listing and upload query parameters for defense in depth
- Add remote shell access via tmux — admin can open a terminal on any agent machine through the existing WebSocket tunnel with `portlama-agent shell <label>`
- Add policy-based shell access control — named policies with IP allow/deny lists, command blocklists, inactivity timeouts, and file size limits
- Add 5-gate auth chain for shell sessions: global toggle → agent cert enabled → time window → IP check → admin cert
- Add shell session recording via `tmux pipe-pane`, stored on agent at `~/.portlama/shell-recordings/`
- Add session audit log on the panel server (`shell-sessions.json`)
- Add restricted shell wrapper (`portlama-shell.sh`) with hard-blocked patterns and configurable restricted commands
- Add file transfer between admin and agent: `portlama-agent cp <label>:/path ./local`
- Add session log viewer: `portlama-agent shell-log <label>`
- Add agent shell gateway: `portlama-agent shell-server` (background service, polls panel for shell access)
- Add Shell tab to the desktop app for managing policies, agent access, and sessions
- Add `GET /api/shell/agent-status` endpoint for agents to check their own shell access

### Changed

- Update site file endpoints (`GET/POST/DELETE /api/sites/:id/files`) to accept agent certificates with appropriate capabilities
- Update `GET /api/sites` to filter results based on agent's `allowedSites` when accessed with an agent certificate
- Update sudoers template to use `portlama:portlama` instead of installer's UID for file ownership

### Security

- Add P12 password removed from process listings — agent curl calls use temporary config file (`-K`, O_EXCL + 0600), openssl uses `PORTLAMA_P12_PASS` environment variable. Stale config files cleaned up at module load.
- Add P12 password protection — curl uses a temporary config file (O_EXCL + mode `0600`, deleted in try/finally) and openssl uses `PORTLAMA_P12_PASS` environment variable, so the password never appears in process listings. Stale config files cleaned up at module load.
- Add PEM private key cleanup after CA extraction during setup — only `ca.crt` persists, client cert/key PEM files are deleted
- Add restrictive directory permissions (`0700`) on `~/.portlama/` and `~/.portlama/.pem/`
- Add curl config file atomic creation with `O_EXCL` and `0o600` permissions in the desktop app, preventing symlink attacks and race conditions
- Add input validation for custom service definitions — binary names, process names, categories validated against strict allowlists with length and count limits
- Add registry file validation on load to reject tampered entries in the desktop app
- Add subprocess timeouts (5-10s) on `pgrep`, `lsof`, and `docker ps` commands in the desktop app to prevent hangs
- Add Mutex-based serialization for registry mutations in the desktop app to prevent concurrent write races
- Add server-side file extension allowlist enforcement — blocks uploads of executable, scripting, and unknown file types regardless of client
- Add client-side (agent) file extension allowlist — catches disallowed files early with helpful error messages before upload
- Add ClamAV malware scanning in deploy pipeline — prevents deploying infected content to static sites
- Add symlink protection in deploy command directory scanner (skips symlinks, uses `lstat` to prevent TOCTOU)
- Add `encodeURIComponent` on all dynamic URL path segments in panel client API helpers and agent CLI
- Add regex validation on `allowedSites` entries in `UpdateAllowedSitesSchema`
- Add tmux special-key allowlist in shell gateway — only permitted key names (Enter, Escape, arrows, etc.) accepted
- Add strict CIDR prefix validation (1-32) for shell policy IP lists
- Add IPv6 normalization for IP access control — strips `::ffff:` prefix from IPv4-mapped addresses
- Add Mutex-based locking on shell session audit log to prevent concurrent write races
- Add PEM private key file permissions (0o600) in agent WebSocket helpers
- Add URL encoding on all dynamic path segments in desktop app Rust API calls

**Affected packages:**

- `@lamalibre/portlama-panel-server` 0.1.0 → 0.1.3
- `@lamalibre/portlama-panel-client` 0.1.0 → 0.1.2
- `@lamalibre/create-portlama` 1.0.23 → 1.0.26
- `@lamalibre/portlama-agent` 1.0.1 → 1.0.5
- `@lamalibre/portlama-desktop` 0.1.0 → 0.1.2
- `@lamalibre/install-portlama-desktop` 0.0.2 → 0.0.3

## [1.0.0] - 2026-03-12

### Added

- Initial release
- One-command installer (`npx @lamalibre/create-portlama`)
- Management dashboard with system stats and service health
- Tunnel management: CRUD, nginx vhost generation, TLS certificates
- User management: Authelia user CRUD, TOTP enrollment
- Certificate management: listing, renewal, mTLS rotation
- Mac launchd plist generation for Chisel client
- mTLS authentication for panel access
- Service control: start/stop/restart with live log streaming
- Browser-based onboarding wizard (domain, DNS verification, stack provisioning)
- OS hardening: swap, UFW, fail2ban, SSH lockdown
