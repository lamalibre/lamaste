# Agent-Hosted Plugins

An **agent-hosted plugin** is an application that runs on one of your agents — typically a VM — while its admin pages live in the Lamaste panel. Lamaste never runs the plugin's code on the relay. This page covers what Lamaste adds for a plugin whose manifest has an `agent` block: hosting it on an agent, the internal plugin tunnel, the forwarded admin API, the installation secret, the health monitor and what the panel shows while the hosting agent is offline, the plugin's [settings and secrets](#settings) — and, for a plugin that names its agent package, installing, updating and removing that agent half on the agent from the panel ([Hosting with an agent half](#hosting-with-an-agent-half)). What happens on the agent machine itself — the root helper, the unit, the signed jobs — is in [App Host](app-host.md). The hooks a plugin can run around all of these — and their approval — are in [Lifecycle Hooks](lifecycle-hooks.md). The full design is `plugin-development/design/agent-hosted-app-plugins.md`.

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
| `settings`       | What an administrator configures — values and secrets the agent half stores. Only with an `agent` block. See [Settings](#settings).                                                                                                                                                                                                                                                       |

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
  "pluginName": "market-indicators",
  "agentLastSeenAt": "2026-10-15T10:04:51.000Z"
}
```

`phase` is `installing` (the install pipeline runs: secret delivered, tunnel not yet granted), `active`, or `removing` (the uninstall pipeline runs: tunnel gone, secret not yet). The forwarder and the health monitor use only active hostings. `agentHalf` is the version of the agent half Lamaste installed that the agent reported running (`null`: installed by hand, or not yet). `pluginName` is the plugin that owns the hosting: no operation of one plugin reads, changes or removes a hosting another plugin owns (`409`, `code: "hosting_owner_mismatch"`). `agentLastSeenAt` is when the hosting agent last contacted the relay (`null` until its first such call) — see [When the hosting agent is offline](#when-the-hosting-agent-is-offline).

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

An update whose agent half differs waits for approval like a changed hook set: `pendingUpdate` is `{ version, digest, stagedAt, relay, agentHalf, settings, autoApproveWithheld }` (`relay` and `agentHalf` are `null` when the version brings none; `settings` is how it changes the [settings schema](#in-the-plugin-list-and-the-update-preview), outside the digest). **Auto-approve** covers a new version and tarball of the same agent half — what every release brings — and is **withheld** when the version brings an agent half where there was none, changes the agent package, adds system packages, or changes the service entry or memory limit: those run as root on the agent and wait for an administrator. `autoApproveWithheld` says why; the audit log records `hooks.auto-approve.withheld` and the administrators are notified.

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
- **Mapping:** `/api/<route>/<rest>?query` → `http://127.0.0.1:<port>/admin/<rest>?query` on the relay's loopback, the relay end of the internal tunnel. Only `/admin/*` of the agent half is reachable; its `/app/*` (the user surface) is not, and neither are `/admin/hooks/*` (Lamaste's lifecycle hook calls) and `/admin/settings` with everything under it (where Lamaste writes the plugin's [settings](#between-the-relay-and-the-agent-half)) — `404` however they are spelled. A path segment with an encoded `/` or `\` is refused (`400`).
- **Request hooks:** a plugin's approved `request:pre-forward` / `request:post-forward` hooks run on the routes they name; a plugin whose relay hooks are not approved is refused (`503`, `code: "hooks_not_approved"`). See [Lifecycle Hooks](lifecycle-hooks.md#request).
- **Caller assertion:** `X-Lamalibre-Caller: <base64url(payload)>.<base64url(hmac)>` — payload `{ v: 1, plugin, caller, method, path, iat, nonce }`, HMAC-SHA256 with the installation secret, valid 60 seconds (5 seconds of clock skew), nonces refused on a second sight.
- **Streaming:** request and response bodies are piped, never buffered; `text/event-stream` responses pass through unbuffered (nginx is told `X-Accel-Buffering: no`). The tunnel's body limit (`maxBodySizeMb`, default 10) is enforced: a larger `Content-Length` is `413` before anything is sent, and a chunked body that grows past it is cut off.
- **Timeouts:** `504` when the agent half has not sent its headers after 30 seconds; a response body (not an event stream) that stays silent for five minutes is cut off.
- **Headers:** the caller's `Cookie` and `Authorization`, nginx's `X-SSL-Client-*`, anything under `X-Lamalibre-*` or `Remote-*`, and hop-by-hop headers never reach the agent half; `Set-Cookie` from the application never reaches the client.
- **Failures:** `502` with `reason: "tunnel"` when nothing listens on the port (the agent is not connected), `502` with `reason: "app"` when the connection drops before the headers (the tunnel is up, the agent half is not), `503` while the plugin is disabled or not yet hosted. While the plugin is down, its `tunnel:down` hook's fallback answers instead of the 502.
- **Logging:** one line per request — plugin, caller, method, path without its query, status, duration. Never a body.

## Health

Every 10 seconds, for every active hosting of an enabled plugin, the panel connects to the relay-loopback port and then calls `GET /admin/health` on the agent half with a caller assertion naming Lamaste itself (`{ "type": "lamaste" }`). A refused connect means the **tunnel** is down; a failed health call means the tunnel is up and the **application** is down. The state changes to `down` after three consecutive failures of the same reason and to `up` after two consecutive successes; each transition is persisted (`health` on the hosting record, with `reason`, `since`, `lastError`) and runs the plugin's `tunnel:down` / `tunnel:up` relay hook. The forwarder still attempts every request; the state decides whether a failure is answered with the hook's fallback.

## When the hosting agent is offline

A hosting that is `down` is one of two outages. Reason **`tunnel`**: nothing listens on the internal tunnel's port on the relay — the hosting agent is offline, or its chisel client is. Reason **`app`**: the tunnel answers and the agent half does not. For the first, what an administrator wants to know is how long the agent has been gone, which the health monitor's `since` cannot say (it is when the monitor noticed), so the relay keeps each agent's **last contact**.

Every call an agent certificate makes to `GET /api/tunnels/agent-config` — the agent's sync, every 30 seconds — records that agent; an administrator naming an agent with `?agent=` does not. The time is kept in memory and written to `state.db` (`agent_presence`) at most once a minute per agent, never through the `agents` table, which the registry rewrites whole; a restart of the panel loses at most that minute. Revoking the agent's certificate forgets it, so a later enrollment under the label does not inherit it. It is reported as:

- `lastSeenAt` on each entry of `GET /api/certs/agent` — `null` until the agent's first such call, and for a revoked agent;
- `agentLastSeenAt` on a hosting — `GET /api/plugins/:name/hosting`, `agentHosting` on `GET /api/plugins` — and on `hosting` of the [settings view](#get-api-plugins-name-settings).

What the panel shows while a hosting is down:

- **The plugin's pages** check the hosting before they fetch the bundle — which comes from the agent half, so it could only fail, after the forwarder's 30-second timeout. They show "Hosting agent vm1 is offline since 14:05:12 (12m ago) — last sync 14:04:40 (13m ago)" for `tunnel` or "The agent half is not responding since 14:05:12 (12m ago)" for `app`, read the plugin list again every 10 seconds and open the pages once the hosting is up. A plugin that is not hosted, or whose hosting is being set up or removed, says so in the same place. Pages already open stay open, with the outage shown above them. A server plugin loads as before, and so does any plugin when the plugin list cannot be read.
- **The sidebar** marks the plugin's pages, with the same sentence.
- **The plugin's card** on the Plugins page shows the outage with its health, and its Settings section is read-only from the relay's cache, with the same reason ([Settings](#in-the-panel)).

`lamaste-server plugins settings <name>` prints the same sentence, and `plugins configure` refuses with it.

## Settings

A plugin with an agent half may declare **settings**: what an administrator configures for it — an API key, a schedule, a region. The **agent half is the system of record**: it stores the values in its own data directory and answers `GET` and `PUT /admin/settings` for Lamaste alone. The panel shows them as a form, checks a change and carries it to the agent half through the internal tunnel; it keeps a cache of the non-secret values and of _when_ each secret was set — never a secret's value. A secret exists on the relay only in the memory of the request that carries it to the agent half ([Security Model](../01-concepts/security-model.md), 5e).

Settings are not part of the [approval digest](#approval): they declare data, not code, and nothing they change runs with more privilege. Because the agent half holds them, they can be changed only while its hosting is up; while it is offline the panel shows them from its cache, read-only.

### The settings block

```json
"settings": {
  "schemaVersion": 1,
  "fields": [
    { "key": "apiKey", "label": "API key", "type": "secret", "required": true },
    {
      "key": "schedule",
      "label": "Daily sync time",
      "type": "string",
      "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$",
      "default": "06:00"
    },
    { "key": "retries", "label": "Retries", "type": "integer", "min": 0, "max": 10, "default": 3 },
    {
      "key": "region",
      "label": "Region",
      "type": "enum",
      "options": [
        { "value": "eu", "label": "Europe" },
        { "value": "us", "label": "United States" }
      ]
    },
    { "key": "verbose", "label": "Verbose logging", "type": "boolean", "default": false }
  ]
}
```

Only in a manifest with an `agent` block — the agent half stores the values (`400`, "settings needs an agent block"). Both the block and its fields are strict: an unknown property is refused.

| Property        | Meaning                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | An integer of at least 1, bumped by the plugin when its fields change. Every change the relay sends names the installed manifest's version, and an agent half running another one refuses it (`409`, `schema_mismatch`) — during an update, until both sides run the same version. |
| `fields`        | 1–50 fields; keys are unique.                                                                                                                                                                                                                                                      |
| `key`           | A lower-case letter, then letters and digits, at most 64 characters (`^[a-z][A-Za-z0-9]{0,63}$`).                                                                                                                                                                                  |
| `label`         | 1–100 characters. `description` (optional): at most 500.                                                                                                                                                                                                                           |
| `type`          | `string`, `secret` (a non-empty string the panel never shows), `integer` (a safe integer), `number` (finite), `boolean` or `enum`.                                                                                                                                                 |
| `required`      | A required secret that is not set, or a required non-secret field with neither a stored value nor a default, leaves the plugin **needing configuration**.                                                                                                                          |
| `default`       | Never on a secret. Must itself be a valid value of the field — its type, length, range, option and pattern, checked once when the manifest is validated.                                                                                                                           |
| `maxLength`     | `string` and `secret` only: 1–4096; 1024 when not set.                                                                                                                                                                                                                             |
| `min`, `max`    | `integer` and `number` only; `min` not greater than `max`.                                                                                                                                                                                                                         |
| `pattern`       | `string` only, at most 256 characters; must compile as `new RegExp(pattern, 'u')`. Tested **unanchored** — anchor it with `^` and `$` when it means the whole value.                                                                                                               |
| `options`       | `enum` only, and required there: 1–100 `{ value, label }` (a value of 1–200 characters, unique; a label of 1–100).                                                                                                                                                                 |

**Who tests `pattern`.** The form, in the administrator's browser, and the agent half — never the panel process, and never `lamaste-server`, which runs as root on the relay: a manifest's regular expression must not be able to stall the panel or run as root. The panel checks everything else — type, required, length, range, option — so a value that only the pattern refuses comes back from the agent half (`422`). **Validation messages never contain the value**: a secret typed into the wrong field must not come back in an error, a log line or a response. That is why settings values are checked by hand and not with zod's enum or literal schemas, whose messages repeat what they received.

### Reading and changing settings

Admin only.

#### `GET /api/plugins/:name/settings`

```json
{
  "schemaVersion": 1,
  "fields": [{ "key": "apiKey", "label": "API key", "type": "secret", "required": true }, "…"],
  "values": {
    "apiKey": { "set": true, "setAt": "2026-10-16T10:00:00.000Z" },
    "schedule": "06:00",
    "retries": 5,
    "verbose": false
  },
  "configured": true,
  "missing": [],
  "revision": 3,
  "source": "live",
  "syncedAt": "2026-10-16T10:05:00.000Z",
  "hosting": {
    "agentLabel": "vm1",
    "phase": "active",
    "state": "up",
    "reason": null,
    "since": "2026-10-16T09:00:00.000Z",
    "agentLastSeenAt": "2026-10-16T10:04:51.000Z"
  }
}
```

| Field                   | Meaning                                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`                | The installed manifest's fields, as declared (`pattern` included, for the form)                                                                                                                                                                                 |
| `values`                | Each non-secret field's effective value — the stored one, else its default; absent when it has neither (`region` above). Each secret as `{ "set": true, "setAt" }` or `{ "set": false }` — never a value                                                        |
| `configured`, `missing` | Whether a required field lacks a value, and which, in schema order — as the agent half reported them                                                                                                                                                            |
| `revision`              | The agent half's revision (+1 per change), which a change names; `null` while the relay never read the settings                                                                                                                                                 |
| `source`                | `live`: read from the agent half for this answer (the hosting is `active` and its health is not `down`; 5 s). `cache`: the relay's last read, at `syncedAt` — the agent half is offline or did not answer. `none`: never read — the defaults, `revision` `null` |
| `hosting`               | `null` when the plugin is not hosted; else the hosting agent, the hosting's `phase`, the health monitor's `state`, `reason` and `since`, and when the agent last contacted the relay ([offline](#when-the-hosting-agent-is-offline))                            |

`404` when the plugin is not installed, and with `code: "no_settings"` when it declares no settings.

#### `PUT /api/plugins/:name/settings`

```json
{
  "revision": 3,
  "values": { "retries": 5, "region": null },
  "secrets": { "apiKey": "…" }
}
```

A partial change: only the keys it names change. `revision` is the revision the administrator read. A secret goes in `secrets`, every other field in `values` (each in the wrong one is refused per key), and the body holds nothing else. `null` puts a non-secret field back to its default — or unset, when it has none — and clears a secret; both are refused for a field that must have a value. At most 256 KiB (`413`); 30 requests a minute.

The panel checks the change against the installed schema — without `pattern` — and sends it to the agent half (`PUT /admin/settings`, 15 s), whose answer decides: on success the panel caches the agent half's new state, records the change and answers `200` with the settings as `GET` returns them (`source: "live"`). A change that changes nothing stores nothing and answers the settings as they are. Changes and reads of one plugin's settings run one at a time, so a slow read cannot put back what a change replaced.

| Status | `code`                 | When                                                                                                                                 |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | —                      | The panel refused it: `errors`, a message per field key (`_` for the body as a whole, or a name that could not be a setting)         |
| 404    | `no_settings`          | The plugin declares no settings (without a code: it is not installed)                                                                |
| 409    | `operation_running`    | An operation of the plugin runs (`operationId`) — an update may be changing the schema                                               |
| 409    | `revision_mismatch`    | The settings changed since they were read; `revision` is the current one. Read them again and make the change on them                |
| 409    | `schema_mismatch`      | The agent half runs another version of the settings schema — let the plugin's update finish                                          |
| 409    | `conflict`             | The agent half refused it as conflicting, for another reason                                                                         |
| 422    | —                      | The agent half refused it: `errors` per field — its `pattern`, or its own schema                                                     |
| 502    | `settings_unsupported` | The agent half does not answer `/admin/settings` (`404`) — it predates settings; update the plugin                                   |
| 502    | `refused`              | Nothing answers on the internal tunnel's port                                                                                        |
| 502    | `invalid`, `other`     | The agent half answered too large a body or in another shape (reload the settings to see what it stored), or could not be reached    |
| 502    | `agent_half_error`     | The agent half answered another status (`status`)                                                                                    |
| 503    | `hosting_offline`      | The plugin is not hosted, its hosting is not `active`, or its health is `down` — with `hosting` as in `GET` (`null` when not hosted) |
| 504    | `timeout`              | No answer within 15 s — the change may or may not have been stored; read the settings again                                          |

Once the plugin and its settings block are found, the checks run in this order: the body (`400`), a running operation (`409`), the hosting (`503`), then the agent half. A refusal answers `{ error, code?, errors?, revision?, operationId?, hosting?, status? }`, built from what Lamaste found and never from the request body. The agent half's per-field messages are passed on only under keys a setting can have, cut to 300 characters, and replaced by `Invalid value` when one contains a secret of the change: the agent half is Lamaste code that never repeats a value, but the relay does not answer with one on its word.

A stored change is recorded in the [audit log](audit-and-notifications.md) as `plugin.settings.updated` with key names only — `changed`, `cleared`, `secretsSet`, `secretsCleared` — the new `revision` and the certificate serial.

#### In the plugin list and the update preview

`GET /api/plugins`, `GET /api/plugins/:name` and the install response carry, for a plugin that declares settings, `settings: { configured, missing, syncedAt }` in place of its schema — no values — from the relay's cache, or from the schema alone while the relay never read the settings (`syncedAt: null`). The Plugins page shows **Needs configuration** from it.

An update's preview — `pendingUpdate.settings`, in `GET /api/plugins/:name/hooks` and the update response — says how the version changes the schema: `{ added, removed, retyped, newRequired }`, `null` when neither version declares settings. `retyped` are fields whose type changes; their values are dropped on both sides, never converted. `newRequired` are fields required without a default in the new version that were not before (absent, optional or with a default), and required fields that are retyped. The panel shows it next to what the update asks to approve, but it is not part of the digest. After the update the plugin needs configuration until those fields are filled.

### Between the relay and the agent half

The relay calls the agent half with `callAgentHalf` (`@lamalibre/lamaste`, also exported from `@lamalibre/lamaste/server`): one JSON request to `http://127.0.0.1:<port>/admin/…` — the relay end of the internal tunnel — with a caller assertion naming Lamaste itself (`{ "type": "lamaste" }`), answered with whatever status the agent half gives. It calls only paths under `/admin/` without `.` or `..` segments, with `GET`, `PUT`, `POST` or `DELETE`, and throws before sending anything otherwise; it sends a body as `application/json`, bounds the time and the response size, and resolves `{ ok: true, status, body }` (the parsed JSON, or `null`) or `{ ok: false, code, error }` — `refused` (nothing listens), `timeout`, `invalid` (a response over the size limit) or `other` — with an error that never contains the request body. The hook call `callAgentHalfHook` is built on the same request.

| Call                          | Body                                                                | Answer                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/settings`         | —                                                                   | `200` the state                                                                                                                                                                                                                       |
| `PUT /admin/settings`         | `{ schemaVersion, baseRevision, values, secrets }`, at most 256 KiB | `200` the new state; `409 { error, code: "schema_mismatch" }`; `409 { error, code: "revision_mismatch", revision }`; `422 { error: "Invalid settings", errors }`; `400` a body that is not JSON or not of that shape; `413` too large |
| `POST /admin/settings/reload` | —                                                                   | `200` the state, read again from the files                                                                                                                                                                                            |

The state, which every answer of the relay's reads and changes is built from:

```json
{
  "schemaVersion": 1,
  "revision": 3,
  "values": { "retries": 5 },
  "secrets": { "apiKey": { "setAt": "2026-10-16T10:00:00.000Z" } },
  "configured": true,
  "missing": []
}
```

`values` are the explicitly stored non-secret values — no defaults; `secrets` names the secrets that are set, and when — never a value. In a change, `schemaVersion` is the relay's installed manifest's, `baseRevision` the revision the administrator edited, and `values` and `secrets` the change the panel validated (`null` clears). Responses are 256 KiB at most. The relay parses every state with `parseAgentHalfSettingsState`, which builds a fresh object of the contract's fields: nothing else the agent half sent — a secret's value in particular — survives into the cache.

Only Lamaste: a caller assertion that does not verify is `401`, one naming an administrator or an agent `403`; another path under `/admin/settings` is `404`, a method a path does not take `405`. The **forwarder reserves `/admin/settings`** and everything under it as it reserves `/admin/hooks/*`: `/api/<route>/settings`, `/api/<route>/Settings` and `/api/<route>/%73ettings/x` all answer `404` and reach nothing. No forwarded caller — an administrator, or an agent holding one of the plugin's capabilities — reads or changes the settings behind the panel's validation, and the relay's cache cannot drift from the agent half. An agent half's own admin routes cannot live there.

`POST /admin/settings/reload` is for a restore that puts older files in place while the agent half runs; Lamaste does not call it today, and since the forwarder reserves it nothing else can. An agent half that is restarted after a restore reads its files when it starts.

### In the agent half

`@lamalibre/lamaste/agent` holds the store and the handler, so that no plugin reimplements how a secret is stored:

- **`settingsFromManifest(manifest)`** — the `settings` block of the agent half's own copy of its manifest (bundled with it), validated; throws `ManifestValidationError` when it is missing or invalid. The agent half checks values against this schema, not the relay's.
- **`createSettingsStore({ dataDir, settings })`** — the store over two files in `dataDir`, which must exist: for an agent half Lamaste installs, `LAMASTE_APP_DATA_DIR`, the only directory its unit may write ([App Host](app-host.md)). One store per process. `load()` reads and reconciles the files and must run before anything else; then `state()` is what `GET` answers, `values()` the values the plugin runs with (defaults overlaid by the stored values, never a secret), `secret(key)` a secret's value for the agent half's own use (`undefined` when it is not set), `configured()`, `update(change)`, `reload()`, and `onChange(listener)` — called with the new state after every update and reload, returning its unsubscribe function; a listener that throws does not fail the update, which is stored.
- **`createSettingsHandler({ verifier, store })`** — answers `/admin/settings` as above. Framework-agnostic, like `createAgentHookHandler`: pass `{ method, url, headers, body }` (the raw body, or an object a framework already parsed) and send the `{ status, body }` it returns. No answer carries a secret's value; a store that fails is `500` without its message.

| File                      | Contents                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<dataDir>/settings.json` | `{ v: 1, schemaVersion, revision, values: { <key>: { type, value } } }` — each non-secret value with the type of the field it was stored for; written on every change |
| `<dataDir>/secrets.json`  | `{ v: 1, secrets: { <key>: { value, setAt } } }` — written only when a secret changes                                                                                 |

Both are 0600, owned by the account the agent half runs as, and written atomically: an exclusive temp file in the same directory (`wx` — never opened through an existing file or link), `fsync`, rename, `fsync` of the directory. A symbolic link — or anything but a regular file — where either belongs is refused, on read (checked, then opened with `O_NOFOLLOW`) and on write. A missing file is empty; a malformed one, or one over 4 MiB, is an error that names the file and never repeats its contents. A secret never goes into `settings.json`.

**Reconcile.** `load()` and `reload()` reconcile the stored values with the agent half's own schema. A key the schema no longer knows is dropped; so is a value recorded for another type than its field has now — a **retyped value is dropped, never converted**: a secret whose field became a string leaves `secrets.json` and never lands in `settings.json`, and a string whose field became a secret leaves `settings.json` — and so is a value that no longer passes its field's checks, pattern included. A file is rewritten only when something was dropped from it; the revision stays.

**A change** is serialized with every other. A `schemaVersion` other than the agent half's is `409 schema_mismatch`, a `baseRevision` other than the current revision `409 revision_mismatch` with the current `revision`, and a value its checks refuse — pattern included — `422` per field. Otherwise it is applied (`null` clears): `secrets.json` first, when a secret changed, each new secret with `setAt` now; then `settings.json` with the revision plus one; then the listeners.

```js
import {
  createCallerAssertionVerifier,
  createSettingsHandler,
  createSettingsStore,
  settingsFromManifest,
} from '@lamalibre/lamaste/agent';
import manifest from '../lamaste-plugin.json' with { type: 'json' }; // bundled into the agent half

const verifier = createCallerAssertionVerifier({
  configPath: process.env.LAMASTE_APP_CONFIG,
  plugin: 'market-indicators',
});
const settings = createSettingsStore({
  dataDir: process.env.LAMASTE_APP_DATA_DIR,
  settings: settingsFromManifest(manifest),
});
await settings.load();
settings.onChange(() => scheduler.reschedule(settings.values()));
const settingsHandler = createSettingsHandler({ verifier, store: settings });

// in the agent half's router, for /admin/settings and /admin/settings/*:
const { status, body } = await settingsHandler.handle({ method, url, headers, body: rawBody });

// where the plugin uses them:
const { schedule, retries } = settings.values();
const apiKey = settings.secret('apiKey'); // undefined until an administrator sets it
if (!settings.configured()) pauseSync(); // required settings missing
```

### The relay's cache

`state.db` holds one row per plugin in `plugin_settings` (migration `0012`): the agent half's schema version and revision, the non-secret values it stored — for the keys the installed schema knows, and only values that still suit their field — `{ key: setAt }` for the secrets it holds, whether it is configured and what is missing, and when the relay read them (`synced_at`). There is no column for a secret's value. The installed manifest's `settings` block itself is kept on the plugin's row (`plugins.settings`).

The relay reads the agent half's settings after a hosting succeeds, after an update or its revert, whenever the health monitor sees the plugin come up, on every live read, and from the answer to every change. A read that fails is logged with metadata only and keeps the row. The row is deleted when the plugin's hosting is removed — a later hosting reads the settings afresh, from files the agent kept or from none — and when the plugin is uninstalled, with its registry row.

Hook inputs read the cache: a **relay hook**'s `settings` is the plugin's effective non-secret values — each stored value or its default, `{}` while the relay never read them — and an **agent hook** gets `{}`, since the agent half holds the settings itself ([Lifecycle Hooks](lifecycle-hooks.md#writing-hooks)). Neither ever gets a secret.

### Hosting, retained data and updates

- **Hosting takes no settings.** The agent half starts without them — or with the files it kept on that agent — and reports `configured: false` until an administrator fills the required fields. Secrets would otherwise wait in the relay's memory through an operation that can take minutes. Once the hosting is active the relay reads the settings, and the plugin's card shows whether it needs configuration.
- **Retained data.** The files are in the agent half's data directory, so for an agent half Lamaste installs they stay with its [retained data](#retained-data) when it is removed without purge, and come back when the same package is hosted on that agent again; the relay reads them then. A **purge** deletes them with the data directory.
- **Updates.** A version may add, remove or retype fields and bump `schemaVersion`. The new agent half reconciles the files with its schema when it starts: values of fields it no longer has are dropped, and a retyped field's value is dropped — on the relay too, whose cache keeps only values that suit the installed schema — never converted. While the two sides run different schema versions a change is refused (`409 schema_mismatch`), and while the update runs as an operation it is refused anyway (`409 operation_running`); the relay reads the settings again once the update finished or was reverted. Fields the new version newly requires leave the plugin needing configuration.

### In the panel

A plugin that declares settings gets a **Settings** section on its card on the Plugins page: a form generated from its fields — a text input for a string (its length and `pattern` checked in the browser before anything is sent), a number input with its range, a checkbox, a select of an enum's options; a secret as a password input that is never prefilled, says when it was set, and offers **Replace** and — for an optional secret — **Clear**. A secret's value never enters the page's state or its query cache: the form reads the input when it submits and empties it. Only the fields that changed are sent; the panel's and the agent half's messages appear under their fields, and a stale revision reloads the settings. While the hosting is not up, the form is read-only from the cache and says why ("Hosting agent vm1 is offline since … — last sync …"), and reads the settings again every 10 seconds until it can open. The card shows **Needs configuration** while required settings are missing, and an update's approval lists how it changes the settings.

The desktop app's server mode shows the same section, through `AdminClient` `getPluginSettings(name)` and `updatePluginSettings(name, body)` — Tauri commands `admin_get_plugin_settings` and `admin_update_plugin_settings`, which hand the body to curl on stdin, never in its arguments.

### From the CLI

```
lamaste-server plugins settings <name> [--json]
lamaste-server plugins configure <name> [--set key=value]... [--clear key]... [--secrets-stdin]
lamaste-server plugins configure <name>          # in a terminal: asked field by field
```

`settings` prints each field — its key, type and value (a secret only as `set <when>` or `not set`), its label, whether it is required, its range, options and default — then whether the plugin is configured or what is missing, where the values come from (the agent half, the relay's copy and when it was synced, or the defaults when it never was), and the hosting in the panel's words. With `--json` it prints the `GET` answer as one line.

`configure` with flags makes one change from one read: it reads the settings — the schema and the revision — builds the change and sends it with that revision.

| Flag                                     | Meaning                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--set key=value` (or `--set=key=value`) | A non-secret field, the value parsed by the field's type: an integer, a number, `true`/`yes`/`on` or `false`/`no`/`off`, one of an enum's option values, or the text as given. An empty value is refused — use `--clear`. **Refused for a secret**: a command line is readable by other local users |
| `--clear key` (or `--clear=key`)         | Puts a non-secret field back to its default (or unset) and clears a secret; refused for a field that must have a value                                                                                                                                                                              |
| `--secrets-stdin`                        | Reads one JSON object from stdin — `{ "apiKey": "…", "oldToken": null }`: secret keys only, `null` clears — at most 256 KiB. Refused when stdin is a terminal: pipe it in or redirect it from a file                                                                                                |

```bash
lamaste-server plugins configure market-indicators --set retries=5 --clear region --secrets-stdin < secrets.json
```

Each key may be named once across the flags. The change is checked against the schema before anything is sent — without `pattern`, which the agent half tests — and a refused one prints a message per field and sends nothing. Messages name keys, never a value; an argument that could be a secret typed in the wrong place is never repeated.

Without flags, in a terminal (stdin and stdout both), `configure` asks for each field in turn: a secret is kept, replaced — typed into a masked prompt, never shown — or cleared; a boolean is a yes or no; an enum a choice among its options (or back to its default); a string or a number a text prefilled with the current value, empty putting it back to its default. It then lists what changes — a non-secret field with its old and new value, a secret only as set, replaced or cleared — and asks before saving. Without flags it refuses to run with `--json` or without a terminal.

Before sending, `configure` refuses what the panel would: the settings of a plugin that is not hosted, whose hosting is being set up or removed, or whose hosting is down (`hosting_offline`, with since when and the agent's last sync), or that the relay has never read (`settings_not_read`). A refusal of the panel is explained: each field's message; a stale revision (nothing was saved — run it again); a running operation (`plugins operations <name>`); a timeout (`plugins settings <name>` shows what the agent half stored); an agent half that predates settings (`plugins update <name>`).

Both commands exit `0` when they did what was asked — for `configure`, saved the change, found nothing to change, or the administrator declined to save — and `1` for a usage error, a refusal, or a prompt cancelled with Ctrl-C (nothing is saved). With `--json`, `configure` prints `{ "event": "complete", "name", "changed", "cleared", "secretsSet", "secretsCleared", "settings" }` — key names, and the settings as `GET` answers them — and every failure of either command `{ "event": "error", "message", "recoverable": false, "code"?, "errors"?, "revision"?, "operationId"?, "hosting"? }`.

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
lamaste-server plugins settings <name>                    # its settings (secrets only as set), the hosting
lamaste-server plugins configure <name> [--set key=value]... [--clear key]... [--secrets-stdin]
lamaste-server push-install status|on|off                 # the switch, policies, every agent's window
lamaste-server push-install open <agent> [--minutes <n>] [--policy <id>]
lamaste-server push-install close <agent>
lamaste-server push-install default-policy <id>
```

`lamaste-server plugins list` shows where each hosted plugin runs, its health and the agent half version. `host` and `unhost` follow the operation step by step and exit non-zero unless it succeeded. A refusal is explained: `agent_not_eligible` lists the reasons (and points at `eligibility`), `push_install_refused` says which gates a push passes — `lamaste-server` calls the panel from `127.0.0.1`, so the agent's policy must allow that address. `--purge` names the data directory it deletes before it starts. `retained-data` lists every agent's records — marking those of uninstalled plugins — or one plugin's, with the data directory and account of each; `purge-data` says which directory and account it deletes, follows the operation and exits non-zero unless it succeeded; `forget-data` says that nothing on the agent changed and how to remove the data there. `hooks` prints the approval digest, the relay hook set and the agent half (package and version, integrity, entry and memory limit, the account and unit it runs as, its data directory, its system packages), and a pending update's. `settings` and `configure` — interactive in a terminal, a secret only from a masked prompt or stdin, never an argument — are described under [Settings](#from-the-cli). `push-install status` lists the switch, the default policy, each policy's actions, packages and addresses, and each enrolled machine agent's window (`open until …` with its policy, or `closed`); `open` checks the minutes against the bounds the panel reports (default 30).

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
| `state.db` `plugins.settings`                                                   | The installed manifest's settings block — the schema the panel checks a change against          |
| `state.db` `plugin_settings`                                                    | The cache of each plugin's settings: non-secret values, `{ key: setAt }` for secrets, status    |
| `state.db` `agent_presence`                                                     | When each agent last contacted the relay (written at most once a minute per agent)              |
| `/etc/lamalibre/lamaste/push-install-config.json`, `push-install-sessions.json` | The switch and policies; the push log (last 500)                                                |
| `<agent>/agents/<label>/app-plugins/<route>.json`                               | The agent's copy of the port and secret (0600)                                                  |
| `/etc/lamalibre/apps/<route>/plugin-config.json` (agent)                        | The service's copy, for an agent half Lamaste installed (0600, its account)                     |
| `<data directory>/settings.json`, `secrets.json` (agent)                        | The plugin's settings and secrets, kept by the agent half (0600, its account)                   |

Installation secrets leave the relay only through `GET /api/agents/me/plugin-config/:route`, over TLS, to the hosting agent's certificate. Settings secrets never rest on the relay: they cross it in the memory of one request, to the agent half. Files on the agent: [App Host](app-host.md#what-it-creates).
