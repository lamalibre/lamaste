# Agent-Hosted Plugins

An **agent-hosted plugin** is an application that runs on one of your agents — typically a VM — while its admin pages live in the Lamaste panel. Lamaste never runs the plugin's code on the relay. This page covers what Lamaste adds for a plugin whose manifest has an `agent` block: hosting it on an agent, the internal plugin tunnel, the forwarded admin API, the installation secret and the health monitor — and, for a plugin that names its agent package, installing, updating and removing that agent half on the agent from the panel ([Hosting with an agent half](#hosting-with-an-agent-half)). What happens on the agent machine itself — the root helper, the unit, the signed jobs — is in [App Host](app-host.md). The hooks a plugin can run around all of these — and their approval — are in [Lifecycle Hooks](lifecycle-hooks.md). The full design is `plugin-development/design/agent-hosted-app-plugins.md`.

## In Plain English

The plugin has two halves. The **agent half** is the application: it runs on the hosting agent, listens on the agent's loopback and holds the data. The **panel** serves the plugin's pages and forwards every call under `/api/<route>/` to the agent half, over a tunnel that exists only on the relay's loopback — no hostname, no certificate, no DNS. Each forwarded call carries a signed **caller assertion** naming who the panel admitted, so the agent half trusts the panel and nothing else that can reach the relay's loopback.

Hosting a plugin on an agent does three things at once: it creates the internal tunnel (Lamaste picks the port), issues the installation secret, and grants the agent's certificate the capability that lets it — and only it — fetch that secret. The agent's sync timer fetches the secret within about 30 seconds and hands it to the agent half; from then on the panel's pages work. When the manifest names the agent package, hosting also installs the agent half on the agent — the agent downloads exactly the version the relay pinned and its root helper sets it up as a service — once an administrator approved what it brings and the agent's push-install window is open.

## The manifest

```json
{
  "name": "market-indicators",
  "version": "1.0.0",
  "hosting": "agent",
  "agent": {
    "requires": { "node": ">=22", "os": ["linux"], "systemPackages": ["sqlite3"] },
    "package": "@lamalibre/market-indicators-agent",
    "service": { "entry": "dist/agentd.mjs", "memoryMax": "256M" }
  },
  "packages": { "server": "@lamalibre/market-indicators-server" },
  "capabilities": ["plugin:market-indicators:use"],
  "panel": {
    "pages": [{ "path": "/indicators", "title": "Indicators" }],
    "apiPrefix": "/api/market-indicators"
  }
}
```

| Field            | Meaning                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | For a plugin with an `agent` block: exactly its route — no `-server` or `-agent` suffix (its packages keep their names). The route keys its hosting, its internal tunnel, its forwarded API and, on the agent, its account and directories, while its approvals, operations and audit entries go by name; the two must be one. Refused at install otherwise (`400`).                      |
| `hosting`        | `"agent"`. Lamaste never imports the package.                                                                                                                                                                                                                                                                                                                                             |
| `agent`          | The plugin has an agent half Lamaste connects to. Only accepted with `hosting: "agent"`. Without it the plugin is identity only (OIDC clients and capabilities, as Feria), and may not declare a panel.                                                                                                                                                                                   |
| `agent.requires` | Optional. `node` (a semver range), `os` (`linux`, `darwin`), `systemPackages` (Debian names, at most 50). Checked against the agent's [host facts](#host-facts) when Lamaste installs the agent half; for one installed by hand, nothing is checked and the system packages are listed for the operator.                                                                                  |
| `agent.package`  | Optional. The agent half's package: an `@lamalibre/` package published at the plugin's version, one bundled tarball (no dependencies, no install scripts — see [App Host](app-host.md#writing-an-agent-half)). With it, Lamaste installs the agent half on the hosting agent; without it, the agent half is installed by hand. Needs a route that starts and ends with a letter or digit. |
| `agent.service`  | Required with `agent.package`, and only with it. `entry`: a relative `.js`, `.mjs` or `.cjs` path inside the package, run as the service; `memoryMax` (optional): the unit's `MemoryMax=`, `[1-9][0-9]{0,5}` followed by `K`, `M` or `G`.                                                                                                                                                 |
| `panel`          | Allowed with an `agent` block: the pages are listed in the panel, and the bundle at `/api/<route>/panel.js` comes from the agent half (`/admin/panel.js`).                                                                                                                                                                                                                                |
| `hooks`          | Lifecycle hooks on the relay and in the agent half — see [Lifecycle Hooks](lifecycle-hooks.md).                                                                                                                                                                                                                                                                                           |

There is no port in the manifest: Lamaste assigns it when the plugin is hosted.

**Routes are unique.** A plugin's route — its name without a trailing `-server` or `-agent` — belongs to one installed plugin: installing another plugin with the same route is refused (`409`, `code: "route_taken"`, with `route` and `owner`). Plugins installed before the rule that share a route keep it for the one installed first; the others hold no route and can be uninstalled but not hosted (`409`, `code: "route_conflict"`) until they are reinstalled under a route of their own.

**Pinned at install.** Installing (or staging an update of) a plugin with `agent.package` reads the agent package's integrity from the registry the panel installs from (`npm view <package>@<version> dist.integrity`) and pins `{ package, version, integrity }` with the plugin: the approval covers it and the agent installs only a tarball that matches. A version that is not semver without build metadata, an agent package not published at the plugin's version (`400`) or a registry without a SHA-512 integrity for it is refused.

## Hosting endpoints

All admin only.

### `POST /api/plugins/:name/hosting`

```json
{ "agentLabel": "vm1" }
```

Hosts the plugin on an enrolled machine agent: starts the plugin's **install pipeline** as an operation and answers `202 { ok, operation }` (follow it at `GET /api/plugins/:name/operations/:id`). Around the plugin's [install hooks](lifecycle-hooks.md#the-pipelines), Lamaste reserves the internal tunnel — the lowest free port of **21000–21999** (the range Lamaste reserves for internal tunnels; a tunnel created by hand may not use it), without its chisel grant yet — a hosting record with a fresh 32-byte installation secret (phase `installing`), and `plugin:<route>:host` on the agent's certificate; the agent fetches its config; for a plugin with `agent.package` the agent installs the agent half ([below](#hosting-with-an-agent-half)); then the tunnel is granted and Lamaste waits until the agent half answers through it, and the hosting turns `active`. A failure rolls back.

| Status             | Reason                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400                | The plugin is a server plugin or has no `agent` block; the agent is unknown, revoked or a plugin-agent certificate; the relay is not onboarded                                                                                                                                                                                                                            |
| 404                | Plugin not installed                                                                                                                                                                                                                                                                                                                                                      |
| 409                | The plugin is already hosted (a plugin has one hosting agent); another operation of the plugin runs; what it brings is not approved (`hooks_not_approved`); the agent cannot host it (`agent_not_eligible`, with `reasons`); the agent keeps another package's data for the route (`retained_data_conflict`, with `retained`); `route_conflict`; `hosting_owner_mismatch` |
| 400, 403, 404, 500 | `push_install_refused`: a gate of [push install](#push-install-gates) refused installing the agent package — with that gate's status                                                                                                                                                                                                                                      |

The hosting record (`GET`, and `agentHosting` on the plugin list):

```json
{
  "plugin": "market-indicators",
  "agentLabel": "vm1",
  "port": 21000,
  "tunnelId": "…",
  "createdAt": "2026-10-15T10:00:00.000Z",
  "secretIssuedAt": "2026-10-15T10:00:00.000Z",
  "secretAcknowledged": false,
  "rotationPending": false,
  "health": { "state": "unknown", "since": "2026-10-15T10:00:00.000Z" },
  "phase": "active",
  "agentHalf": {
    "package": "@lamalibre/market-indicators-agent",
    "version": "1.0.0",
    "installedAt": "2026-10-15T10:01:30.000Z"
  },
  "pluginName": "market-indicators"
}
```

`phase` is `installing` (the install pipeline runs: secret delivered, tunnel not yet granted), `active`, or `removing` (the uninstall pipeline runs: tunnel gone, secret not yet). The forwarder and the health monitor use only active hostings. `agentHalf` is the version of the agent half Lamaste installed that the agent reported running (`null`: installed by hand, or not yet). `pluginName` is the plugin that owns the hosting: no operation of one plugin reads, changes or removes a hosting another plugin owns (`409`, `code: "hosting_owner_mismatch"`).

### `GET /api/plugins/:name/hosting`

The record above, with the health the monitor observed last (`checkedAt` and `lastError` while it is not up). `404` when the plugin is not hosted. `GET /api/plugins` and `GET /api/plugins/:name` carry the same record as `agentHosting` (`null` when not hosted).

### `DELETE /api/plugins/:name/hosting`

Starts the plugin's **uninstall pipeline** as an operation (`202 { ok, operation }`): its pre-teardown hooks, the tunnel removed (its chisel grant withdrawn), the agent's post-teardown hook while the agent still holds the secret, the agent half Lamaste installed removed, then the secret, the record and the capability (the agent's sync deletes its config file). `?force=true` lets failing pre-teardown hooks pass — for an agent that is gone — and is recorded in the audit log. `?purge=true` also deletes the data directory and service account of an agent half Lamaste installed (kept by default — [retained data](#retained-data)); `400` for an agent half installed by hand. Uninstalling a hosted plugin (`DELETE /api/plugins/:name`, which then answers `202` with its operation) runs the same pipeline first and takes the same `force` and `purge`.

### `POST /api/plugins/:name/hosting/rotate-secret`

Issues a new installation secret (10 per minute). The secret in use becomes the _previous_ one and the panel keeps signing with it until the hosting agent acknowledges the new one — so no request is ever signed with a secret the agent half cannot verify. The agent's sync fetches and acknowledges within about 30 seconds — for an agent half Lamaste installed, only once the service's copy is written too; the response shows `rotationPending: true` until then.

## Hosting with an agent half

For a plugin whose manifest names `agent.package`, Lamaste installs, updates and removes the agent half on the hosting agent itself, through the agent's root helper `lamaste-apphost`, which the agent's operator enables once (`sudo lamaste-agent apphost enable`). The agent machine's side — the helper, what it creates, the unit, the signed jobs — is in [App Host](app-host.md). A manifest without `agent.package` is hosted as before: its agent half is installed by hand, and nothing below is checked.

### The pipelines

The operation's steps, in order:

| Install (hosting)                              | What happens                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relay install:pre-tunnel`                     | The plugin's relay hook, if declared                                                                                                                                                                                                                                                                                   |
| `reserve port, secret and capability`          | The internal tunnel without its chisel grant, the record with its secret (`installing`), `plugin:<route>:host`                                                                                                                                                                                                         |
| `install the agent half`                       | An `app-install` job: the agent's sync fetches exactly the pinned `<package>@<version>` with a registry token the panel brokers, checks its SHA-512 against the pinned integrity, and has its helper install it and start it with the secret reserved above. The agent must report that version with its unit `active` |
| `agent install:pre-tunnel`                     | The agent half's hook, called by the agent's sync on its loopback (an agent job) — the service installed above answers it                                                                                                                                                                                              |
| `grant the tunnel and wait for the agent half` | The chisel grant; Lamaste waits up to 150 s for `/admin/health` through the tunnel                                                                                                                                                                                                                                     |
| `agent install:post-tunnel`                    | Through the tunnel                                                                                                                                                                                                                                                                                                     |
| `relay install:post-tunnel`                    |                                                                                                                                                                                                                                                                                                                        |
| `activate`                                     | The hosting turns `active`                                                                                                                                                                                                                                                                                             |

Uninstall (unhost, or uninstalling a hosted plugin): `relay uninstall:pre-teardown` → `agent uninstall:pre-teardown` → `remove the tunnel` → `agent uninstall:post-teardown` (agent job, while the agent still holds the secret) → `remove the agent half` (an `app-remove` job: unit, code and config; with `purge` its data directory, account and owner record too) → `revoke the secret and the capability` → `relay uninstall:post-teardown`. An agent that is no longer enrolled cannot be reached: the removal is skipped with a warning naming the command that finishes it on the machine, `sudo lamaste-agent apphost remove <route>`.

**Rollback.** Once an install job exists the agent may act on it, whatever it reports later. A failure from then on removes the agent half again (without purge — its data is kept and [recorded](#retained-data)); an install the agent's helper reported as failed was undone by the helper itself, and nothing is recorded for it. The agent never removes or switches an agent half on its own: every recovery is a job the relay signs.

**Update** (`POST /api/plugins/:name/update`, [Lifecycle Hooks](lifecycle-hooks.md#updating-a-plugin)) of a hosted plugin installs the new agent half first: `relay install:pre-tunnel` → `agent install:pre-tunnel` (through the tunnel) → `install the new agent half` (the helper switches `current` and keeps the previous version; Lamaste waits until it answers through the tunnel) → `install the new version` (the relay package) → `agent install:post-tunnel` → `relay install:post-tunnel`. A failure after the install job was dispatched runs `restore the previous version` and `activate the previous agent half` (an `app-activate` job naming the version the hosting recorded). The hosting must be `active` and its agent enrolled (`409` otherwise) and eligible for the new version, and push install must allow `update`. A version may not switch, under a hosting, between an agent half installed by hand and one Lamaste installs, nor drop the agent half (`400` — clear the hosting first).

Every app job is signed by the relay with its signing key when it is created, and the agent's helper runs only what the relay signed ([Signed app jobs](app-host.md#signed-app-jobs)). While the relay's signing key is unusable no app job is created and the step fails.

### Host facts

Each agent reports its host on its sync when the facts change, and once a day: `PUT /api/agents/me/host-facts` (agent certificates only; 10 per minute, 4 KiB).

```json
{
  "os": "linux",
  "arch": "x64",
  "distro": { "id": "ubuntu", "idLike": ["debian"], "versionId": "24.04" },
  "node": "22.13.1",
  "systemd": true,
  "apphost": { "version": 1, "node": "22.13.1", "relayKid": "…32 hex…" }
}
```

| Field     | Meaning                                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `os`      | `linux` or `darwin`                                                                                                                                                                                                                                  |
| `arch`    | Node's `os.arch()`                                                                                                                                                                                                                                   |
| `distro`  | `ID`, `ID_LIKE` and `VERSION_ID` of `/etc/os-release`; `null` on macOS                                                                                                                                                                               |
| `node`    | The Node.js the agent runs — what `agent.requires.node` of an agent half installed by hand would run on                                                                                                                                              |
| `systemd` | systemd is the system manager                                                                                                                                                                                                                        |
| `apphost` | The app host helper; `null` when it is not enabled or does not answer. `version`: its protocol; `node`: the Node.js it — and every agent half it installs — runs on; `relayKid`: the id of the relay key pinned for this agent (`null`: none pinned) |

The relay keeps them on the agent's record (`hostFacts`, `hostFactsAt`; `GET /api/certs/agent`), re-validated on every read. The panel shows them on the Certificates page and in the host dialog. The agent asks its helper only when the helper file changed or a day passed (sudo logs every run); the pinned key is read on every sync, so a re-pin is reported at once. A panel older than 4.3 answers `404`, which the agent logs as a warning.

### `GET /api/plugins/:name/hosting/eligibility`

Which enrolled machine agents can host the plugin, and why the others cannot — what the host dialog lists.

```json
{
  "agents": [
    {
      "label": "mac-mini",
      "eligible": false,
      "reasons": ["Lamaste installs an agent half only on a Linux agent; the agent runs macOS"]
    },
    { "label": "vm1", "eligible": true, "reasons": [] }
  ]
}
```

For a plugin with `agent.package`, each agent's host facts are checked: it reported them at all; `agent.requires.os`; `agent.requires.node` against the helper's Node.js; Linux with systemd; the helper enabled at protocol 1 or later; the relay's signing key usable and the one the agent's helper has pinned (`relayKid`); declared system packages only on Debian or Ubuntu. For an agent half installed by hand every agent is eligible — nothing is checked. Hosting and updating check it again (`409`, `code: "agent_not_eligible"`, with the `reasons`). Admin only.

### Push-install gates

Installing, updating and removing an agent half Lamaste installs are **pushes**: the relay has the agent install, switch or remove code as root. Each is checked when its operation starts — hosting as `install`, an update as `update` (when it starts, not while it waits for approval), unhosting, uninstalling or purging as `uninstall` — against push install:

1. Push install is on for the relay — else `400`.
2. The agent is enrolled — else `404`.
3. The agent's window is open — else `403`.
4. The request's source address passes the agent's policy (`allowedIps`, `deniedIps`) — else `403`. It is the address nginx accepted the administrator's connection from; `lamaste-server` calls the panel from `127.0.0.1`.
5. The policy allows the action (`allowedActions`) and, when `allowedPlugins` is not empty, names the agent package — else `403`.

A refusal carries that status and `code: "push_install_refused"`. A push that passes is logged in the push-install session log (`status: "started"`, with its `operationId`). Removing the agent half of an agent that is no longer enrolled is not gated: nothing can be pushed to it.

To open a window from the panel: the Plugins page's **Push install** section turns push install on, edits policies and opens an agent's window for a number of minutes (default 30); the host dialog shows each agent's window and links there. From the CLI: `lamaste-server push-install on` and `lamaste-server push-install open <agent> [--minutes <n>] [--policy <id>]`. The API: `PATCH /api/plugins/push-install/config { enabled }`, `POST /api/plugins/push-install/enable/:label { durationMinutes, policyId? }` (5–480 minutes; any agent label enrolment allows, up to 63 characters) and `DELETE` the same path to close it. `GET /api/plugins/push-install/config` reports the bounds as `windowMinutes: { "min": 5, "max": 480 }`. The default policy allows `install`, `update`, `uninstall` and `check-prerequisites`; a stored default policy whose actions were never edited gains `uninstall`.

### Approval

What a version brings that Lamaste runs or installs — relay hooks and the agent half — is approved with one digest ([Approval](lifecycle-hooks.md#approval)); for the agent half it covers the package, version, tarball integrity, service and system packages. Hosting waits for it (`409`, `code: "hooks_not_approved"`). `GET /api/plugins/:name/hooks` shows what is to be approved as `agentHalf`:

```json
"agentHalf": {
  "package": "@lamalibre/market-indicators-agent",
  "version": "1.0.0",
  "integrity": "sha512-…",
  "entry": "dist/agentd.mjs",
  "memoryMax": "256M",
  "systemPackages": ["sqlite3"],
  "serviceUser": "lamaste-app-market-indicators",
  "unitName": "lamalibre-app-market-indicators.service",
  "dataDir": "/var/lib/lamalibre/apps/market-indicators"
}
```

An update whose agent half differs waits for approval like a changed hook set: `pendingUpdate` is `{ version, digest, stagedAt, relay, agentHalf, autoApproveWithheld }` (`relay` and `agentHalf` are `null` when the version brings none). **Auto-approve** covers a new version and tarball of the same agent half — what every release brings — and is **withheld** when the version brings an agent half where there was none, changes the agent package, adds system packages, or changes the service entry or memory limit: those run as root on the agent and wait for an administrator. `autoApproveWithheld` says why; the audit log records `hooks.auto-approve.withheld` and the administrators are notified.

### Retained data

Removing an agent half without purge — unhosting, uninstalling, a rolled-back install — keeps its data directory and service account on the agent. The relay records it, one record per agent and route, by the name of the plugin it belonged to, so it can be purged after the plugin is uninstalled too. Hosting the same agent package on that agent again takes the data back and drops the record; another package is refused while it is there (`409`, `code: "retained_data_conflict"`, with the `retained` record), because the data is not its own.

In the panel, the Plugins page lists the records under **Retained data** on the plugin's card and, for plugins that are no longer installed, in **Retained data of uninstalled plugins** below the list. Each record offers **Purge** — its confirmation names the agent, the route, the data directory and the account it deletes; the purge runs as an operation the page follows like any other — and **Forget**, whose confirmation says the data stays on the machine and how to remove it there. The CLI: `lamaste-server plugins retained-data [<name>]`, `purge-data <name> --agent <label>` and `forget-data <name> --agent <label>` ([below](#cli)).

#### `GET /api/plugins/:name/retained-data`

```json
{
  "retainedData": [
    {
      "agentLabel": "vm1",
      "route": "market-indicators",
      "plugin": "market-indicators",
      "package": "@lamalibre/market-indicators-agent",
      "since": "2026-10-16T09:00:00.000Z",
      "operation": "…uuid…",
      "dataDir": "/var/lib/lamalibre/apps/market-indicators",
      "serviceUser": "lamaste-app-market-indicators"
    }
  ]
}
```

`operation` is the operation that removed the agent half (`null` when none did); `dataDir` and `serviceUser` are what a purge deletes on the agent. `GET /api/plugins` carries each plugin's records as `retainedData`, and every agent's — of uninstalled plugins too — as a top-level `retainedData`.

#### `DELETE /api/plugins/:name/retained-data?agentLabel=<label>`

Purges what agent `<label>` keeps (10 per minute): an `app-remove` job with purge — the helper deletes the data directory, the account and the owner record — gated by push install as `uninstall` of the package; `202 { ok, operation }` (kind `purge-data`). With `&forget=true` only the relay's record goes and the agent is not touched — for an agent that is gone, or data removed on the machine by hand: `200 { ok, forgotten }`. Both are audited.

| Status | Reason                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 404    | That agent keeps no data of the plugin                                                                                                                                                                                                                                     |
| 409    | The plugin is hosted on that agent and uses the data (`retained_data_in_use` — remove its hosting with purge instead); the agent is no longer enrolled (`agent_not_enrolled` — purge on the machine with `sudo lamaste-agent apphost remove <route> --purge`, then forget) |

`DELETE /api/plugins/:name?purge=true` of a plugin that is not hosted is refused (`400`), naming the agents that keep its data. The refusals that send an administrator to retained data — `retained_data_conflict`, `agent_not_enrolled` and that `400` — name the panel's Retained data and the `lamaste-server plugins purge-data|forget-data` commands.

### Error codes

A refused plugin operation answers `{ error, code?, reasons?, retained?, route?, owner?, operationId? }`:

| `code`                   | Status             | When                                                                                                               |
| ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `hooks_not_approved`     | 409                | Hosting a plugin whose relay hooks or agent half are not approved (the forwarded API answers `503` with this code) |
| `agent_not_eligible`     | 409                | Hosting or updating on an agent that cannot host the agent half — `reasons` lists why                              |
| `push_install_refused`   | 400, 403, 404, 500 | A push-install gate refused installing, updating or removing the agent half                                        |
| `route_taken`            | 409                | Installing a plugin whose route another installed plugin holds — `route` and `owner`                               |
| `route_conflict`         | 409                | The plugin holds no route (it shared one before routes were unique) or is not named by its route                   |
| `hosting_owner_mismatch` | 409                | The hosting on the plugin's route belongs to another plugin                                                        |
| `retained_data_conflict` | 409                | The agent keeps another agent package's data for the route — `retained` is its record                              |
| `retained_data_in_use`   | 409                | Purging retained data the plugin's hosting uses                                                                    |
| `agent_not_enrolled`     | 409                | Purging retained data of an agent that is no longer enrolled                                                       |

`409` with `operationId` and no `code`: another operation of the plugin is running.

## The hosting agent's endpoints

Identity comes strictly from the agent's mTLS certificate, which must carry `plugin:<route>:host`; the hosting must name that agent.

### `GET /api/agents/me/plugin-config/:route`

```json
{
  "plugin": "market-indicators",
  "port": 21000,
  "secret": "…64 hex…",
  "issuedAt": "2026-10-15T10:00:00.000Z",
  "previousSecret": "…",
  "previousIssuedAt": "…"
}
```

`previousSecret` is present only during a rotation. `403` without the capability (an admin certificate has no agent identity and is refused too), `404` when the plugin is not hosted on this agent.

### `POST /api/agents/me/plugin-config/:route/ack`

```json
{ "issuedAt": "2026-10-15T10:00:00.000Z" }
```

The agent confirms it holds the secret issued then. Answers `{ "ok": true, "acknowledged": true, "secretIssuedAt": … }`; `acknowledged: false` with the current `secretIssuedAt` when the agent named an older secret, in which case it fetches again.

### `POST /api/agents/me/jobs/:id/result`

The agent reports a job `agentJobs` gave it, once: a hook job `{ "ok": true, "decision": … }`, an app job `{ "ok": true, "app": { "version": "1.0.0", "unit": "active" } }` (`version` `null` and `unit` `absent` after a removal), either `{ "ok": false, "error": "…" }` (one line, at most 500 characters, no secret). Only the machine agent the job is for; a hook job's agent must also hold the plugin's host capability, an app job's need not (purging retained data runs after the hosting and its capability are gone). 64 KiB at most; `404` for an unknown job or another agent's, `409` when it is no longer pending, `400` for a result that does not fit the job's kind.

### `PUT /api/agents/me/host-facts`

What the agent's host offers — see [Host facts](#host-facts).

### `GET /api/agents/me/relay-keys`

`{ "keys": [{ "kid": "…32 hex…", "publicKey": "…base64 DER SPKI…" }], "agentLabel": "vm1" }` — the relay's public key, which signs relay assertions and app jobs, and the label the relay knows the calling agent by (`null` for an admin certificate). `503` while the relay's signing key is unusable. `sudo lamaste-agent apphost enable|pin` pins the first key for the agent's helper ([App Host](app-host.md#pinning-the-relay-key)).

### What the agent does with it

`GET /api/tunnels/agent-config` lists the plugins hosted on the calling agent and the jobs it has to run:

```json
"appPlugins": [
  {
    "route": "market-indicators", "port": 21000, "secretIssuedAt": "…", "secretAcknowledged": true,
    "phase": "active",
    "health": { "state": "up", "since": "…" },
    "agentHooks": [{ "stage": "tunnel:down", "timeoutMs": 60000 }]
  }
],
"agentJobs": [
  {
    "id": "…uuid…", "route": "market-indicators", "kind": "app-install",
    "timeoutMs": 600000, "deadlineAt": "…",
    "spec": {
      "package": "@lamalibre/market-indicators-agent", "version": "1.0.0", "integrity": "sha512-…",
      "service": { "entry": "dist/agentd.mjs", "memoryMax": "256M" }, "systemPackages": ["sqlite3"]
    },
    "signature": { "envelope": "…base64url…", "sig": "…base64url…" }
  }
]
```

`health` is the relay's view of the tunnel (the agent cannot see its own chisel session); the sync calls the agent half's `tunnel:down` / `tunnel:up` when it changes. `agentJobs` are agent hook calls the sync makes on the agent's loopback while there is no tunnel (`kind: "hook"` — see [Lifecycle Hooks](lifecycle-hooks.md#agent-hooks)) and the **app jobs** that install, switch or remove the agent half Lamaste installs: `app-install` (`spec`), `app-activate` (`version`, `package`) and `app-remove` (`purge`, `package`), each with the relay's `signature` over exactly that job ([Signed app jobs](app-host.md#signed-app-jobs)). An app job's timeout is 10 minutes for an install, 2 for an activation and 5 for a removal; its deadline adds 90 s of delivery. Finished jobs are kept a day.

`lamaste-agent sync` (the 30-second timer) fetches a plugin's config when it does not hold the secret issued at `secretIssuedAt`, writes `~/.lamalibre/lamaste/agents/<label>/app-plugins/<route>.json` (0600, atomic), acknowledges it, and removes the file of a plugin the relay no longer lists. For an agent half Lamaste installed it first writes the service's own copy, `/etc/lamalibre/apps/<route>/plugin-config.json`, and acknowledges only once both are written. `sync.log` records `plugin config fetched: <route>` and `plugin config delivered to its service: <route>`.

The agent half reads that file — `LAMALIBRE_LAMASTE_APP_PLUGIN_CONFIG` by convention — for its port and verifies every request on `/admin/*` with `createCallerAssertionVerifier` from `@lamalibre/lamaste/agent`, which re-reads the file when a signature does not verify, so a rotation needs no restart:

```js
import { createCallerAssertionVerifier } from '@lamalibre/lamaste/agent';

const verifier = createCallerAssertionVerifier({ configPath, plugin: 'market-indicators' });
const port = await verifier.port();
// on each /admin request:
const result = await verifier.verify(req.headers, req.method, req.url);
if (!result.ok) return reply.code(401).send({ error: result.reason });
// result.payload.caller is { type: 'admin' }, { type: 'agent', label } or { type: 'lamaste' }
```

## The forwarded admin API

Once the plugin is enabled and hosted, the panel answers `/api/<route>` and `/api/<route>/*`:

- **Authentication** is the panel's: an administrator certificate, or an agent certificate holding one of the plugin's declared capabilities. `plugin:<route>:host` does not admit calls — hosting the application is not using it. `403` otherwise.
- **Mapping:** `/api/<route>/<rest>?query` → `http://127.0.0.1:<port>/admin/<rest>?query` on the relay's loopback, the relay end of the internal tunnel. Only `/admin/*` of the agent half is reachable; its `/app/*` (the user surface) is not, and neither is `/admin/hooks/*` (Lamaste's lifecycle hook calls; `404` however it is spelled). A path segment with an encoded `/` or `\` is refused (`400`).
- **Request hooks:** a plugin's approved `request:pre-forward` / `request:post-forward` hooks run on the routes they name; a plugin whose relay hooks are not approved is refused (`503`, `code: "hooks_not_approved"`). See [Lifecycle Hooks](lifecycle-hooks.md#request).
- **Caller assertion:** `X-Lamalibre-Caller: <base64url(payload)>.<base64url(hmac)>` — payload `{ v: 1, plugin, caller, method, path, iat, nonce }`, HMAC-SHA256 with the installation secret, valid 60 seconds (5 seconds of clock skew), nonces refused on a second sight.
- **Streaming:** request and response bodies are piped, never buffered; `text/event-stream` responses pass through unbuffered (nginx is told `X-Accel-Buffering: no`). The tunnel's body limit (`maxBodySizeMb`, default 10) is enforced: a larger `Content-Length` is `413` before anything is sent, and a chunked body that grows past it is cut off.
- **Timeouts:** `504` when the agent half has not sent its headers after 30 seconds; a response body (not an event stream) that stays silent for five minutes is cut off.
- **Headers:** the caller's `Cookie` and `Authorization`, nginx's `X-SSL-Client-*`, anything under `X-Lamalibre-*` or `Remote-*`, and hop-by-hop headers never reach the agent half; `Set-Cookie` from the application never reaches the client.
- **Failures:** `502` with `reason: "tunnel"` when nothing listens on the port (the agent is not connected), `502` with `reason: "app"` when the connection drops before the headers (the tunnel is up, the agent half is not), `503` while the plugin is disabled or not yet hosted. While the plugin is down, its `tunnel:down` hook's fallback answers instead of the 502.
- **Logging:** one line per request — plugin, caller, method, path without its query, status, duration. Never a body.

## Health

Every 10 seconds, for every active hosting of an enabled plugin, the panel connects to the relay-loopback port and then calls `GET /admin/health` on the agent half with a caller assertion naming Lamaste itself (`{ "type": "lamaste" }`). A refused connect means the **tunnel** is down; a failed health call means the tunnel is up and the **application** is down. The state changes to `down` after three consecutive failures of the same reason and to `up` after two consecutive successes; each transition is persisted (`health` on the hosting record, with `reason`, `since`, `lastError`) and runs the plugin's `tunnel:down` / `tunnel:up` relay hook. The forwarder still attempts every request; the state decides whether a failure is answered with the hook's fallback.

## Internal tunnels

`GET /api/tunnels` lists an internal tunnel with `exposure: "internal"`, `subdomain: null`, `fqdn: null`, no `accessMode`, its `pluginName` and `pluginRoute`, and the hosting agent as `agentLabel`. It cannot be changed or deleted through the tunnels API (`403`) — it belongs to the hosting. Its only effect on the relay is the chisel grant `^R:127\.0\.0\.1:<port>$` for the hosting agent, whose chisel client binds the same port on the agent, where the agent half listens. Gatekeeper and Authelia access control ignore internal tunnels.

## CLI

```
lamaste-server plugins hosting <name>                     # agent, port, secret state, health, agent half version
lamaste-server plugins eligibility <name>                 # which agents can host it, and why the others cannot
lamaste-server plugins host <name> --agent <label>        # host the plugin (follows the operation)
lamaste-server plugins unhost <name> [--force] [--purge]  # remove the hosting
lamaste-server plugins uninstall <name> [--force] [--purge]
lamaste-server plugins rotate-hosting-secret <name>       # new installation secret
lamaste-server plugins retained-data [<name>]             # what agents keep of removed agent halves
lamaste-server plugins purge-data <name> --agent <label>  # delete it on the agent (follows the operation)
lamaste-server plugins forget-data <name> --agent <label> # drop the relay's record only
lamaste-server plugins hooks <name>                       # what needs approval: relay hooks, the agent half
lamaste-server push-install status|on|off                 # the switch, policies, every agent's window
lamaste-server push-install open <agent> [--minutes <n>] [--policy <id>]
lamaste-server push-install close <agent>
lamaste-server push-install default-policy <id>
```

`lamaste-server plugins list` shows where each hosted plugin runs, its health and the agent half version. `host` and `unhost` follow the operation step by step and exit non-zero unless it succeeded. A refusal is explained: `agent_not_eligible` lists the reasons (and points at `eligibility`), `push_install_refused` says which gates a push passes — `lamaste-server` calls the panel from `127.0.0.1`, so the agent's policy must allow that address. `--purge` names the data directory it deletes before it starts. `retained-data` lists every agent's records — marking those of uninstalled plugins — or one plugin's, with the data directory and account of each; `purge-data` says which directory and account it deletes, follows the operation and exits non-zero unless it succeeded; `forget-data` says that nothing on the agent changed and how to remove the data there. `hooks` prints the approval digest, the relay hook set and the agent half (package and version, integrity, entry and memory limit, the account and unit it runs as, its data directory, its system packages), and a pending update's. `push-install status` lists the switch, the default policy, each policy's actions, packages and addresses, and each enrolled machine agent's window (`open until …` with its policy, or `closed`); `open` checks the minutes against the bounds the panel reports (default 30).

## State

| Path                                                                            | Contents                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/etc/lamalibre/lamaste/plugin-hostings.json`                                   | Hosting records with their secrets (0600, atomic, one per plugin), owner and agent half version |
| `/etc/lamalibre/lamaste/tunnels.json`                                           | The internal tunnel, like every tunnel                                                          |
| `state.db` `plugins.route`, `plugins.agent_half_pin`                            | The plugin's unique route; the pinned agent half `{ package, version, integrity }`              |
| `state.db` `agents.host_facts`, `host_facts_at`                                 | What each agent reported about its host                                                         |
| `state.db` `agents.push_install_enabled_until`, `push_install_policy`           | Each agent's push-install window and policy                                                     |
| `state.db` `agent_jobs.payload`, `agent_jobs.signature`                         | App job parameters and the relay's signature over them                                          |
| `state.db` `retained_agent_data`                                                | Data agents keep of removed agent halves                                                        |
| `/etc/lamalibre/lamaste/push-install-config.json`, `push-install-sessions.json` | The switch and policies; the push log (last 500)                                                |
| `<agent>/agents/<label>/app-plugins/<route>.json`                               | The agent's copy of the port and secret (0600)                                                  |
| `/etc/lamalibre/apps/<route>/plugin-config.json` (agent)                        | The service's copy, for an agent half Lamaste installed (0600, its account)                     |

Secrets leave the relay only through `GET /api/agents/me/plugin-config/:route`, over TLS, to the hosting agent's certificate. Files on the agent: [App Host](app-host.md#what-it-creates).
