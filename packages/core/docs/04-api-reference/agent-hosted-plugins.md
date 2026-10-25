# Agent-Hosted Plugins

An **agent-hosted plugin** is an application that runs on one of your agents — typically a VM — while its admin pages live in the Lamaste panel. Lamaste never runs the plugin's code on the relay. This page covers what Lamaste adds for a plugin whose manifest has an `agent` block: hosting it on an agent, the internal plugin tunnel, the forwarded admin API, the installation secret, the health monitor and what the panel shows while the hosting agent is offline, the plugin's [settings and secrets](#settings), its [users and the user surface](#users-and-identity) where they reach it — and, for a plugin that names its agent package, installing, updating and removing that agent half on the agent from the panel ([Hosting with an agent half](#hosting-with-an-agent-half)). What happens on the agent machine itself — the root helper, the unit, the signed jobs — is in [App Host](app-host.md). The hooks a plugin can run around all of these — and their approval — are in [Lifecycle Hooks](lifecycle-hooks.md). The full design is `plugin-development/design/agent-hosted-app-plugins.md`.

## In Plain English

The plugin has two halves. The **agent half** is the application: it runs on the hosting agent, listens on the agent's loopback and holds the data. The **panel** serves the plugin's pages and forwards every call under `/api/<route>/` to the agent half, over a tunnel that exists only on the relay's loopback — no hostname, no certificate, no DNS. Each forwarded call carries a signed **caller assertion** naming who the panel admitted, and every answer carries the agent half's **responder signature**, so the agent half trusts the panel and the panel trusts the agent half — and nothing else that can reach, or take, a loopback port on either machine ([Authentication between the relay and the agent half](#authentication-between-the-relay-and-the-agent-half)).

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
  },
  "identity": {
    "roles": [{ "id": "viewer", "label": "Viewer", "description": "Sees the dashboard" }],
    "attributes": ["displayName"]
  },
  "userSurface": {
    "web": { "defaultSubdomain": "piyasa", "accessMode": "authenticated", "root": "web" }
  }
}
```

| Field            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`           | For a plugin with an `agent` block: exactly its route — no `-server` or `-agent` suffix (its packages keep their names). The route keys its hosting, its internal tunnel, its forwarded API and, on the agent, its account and directories, while its approvals, operations and audit entries go by name; the two must be one. Refused at install otherwise (`400`).                                                                                             |
| `hosting`        | `"agent"`. Lamaste never imports the package.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `agent`          | The plugin has an agent half Lamaste connects to. Only accepted with `hosting: "agent"`. Without it the plugin is identity only (OIDC clients and capabilities, as Feria), and may not declare a panel.                                                                                                                                                                                                                                                          |
| `agent.requires` | Optional. `node` (a semver range), `os` (`linux`, `darwin`), `systemPackages` (Debian names, at most 50). Checked against the agent's [host facts](#host-facts) when Lamaste installs the agent half; for one installed by hand, nothing is checked and the system packages are listed for the operator.                                                                                                                                                         |
| `agent.package`  | Optional. The agent half's package: an `@lamalibre/` package published at the plugin's version, one bundled tarball (no dependencies, no install scripts — see [App Host](app-host.md#writing-an-agent-half)). With it, Lamaste installs the agent half on the hosting agent; without it, the agent half is installed by hand. Needs a route that starts and ends with a letter or digit.                                                                        |
| `agent.service`  | Required with `agent.package`, and only with it. `entry`: a relative `.js`, `.mjs` or `.cjs` path inside the package, run as the service; `memoryMax` (optional): the unit's `MemoryMax=`, `[1-9][0-9]{0,5}` followed by `K`, `M` or `G`.                                                                                                                                                                                                                        |
| `panel`          | Allowed with an `agent` block: the pages are listed in the panel, and the bundle at `/api/<route>/panel.js` comes from the agent half (`/admin/panel.js`).                                                                                                                                                                                                                                                                                                       |
| `hooks`          | Lifecycle hooks on the relay and in the agent half — see [Lifecycle Hooks](lifecycle-hooks.md).                                                                                                                                                                                                                                                                                                                                                                  |
| `settings`       | What an administrator configures — values and secrets the agent half stores. Only with an `agent` block. See [Settings](#settings).                                                                                                                                                                                                                                                                                                                              |
| `identity`       | The plugin's users: its roles (1–32, `{ id, label, description? }`) and the user attributes it may receive (`attributes`, a subset of `displayName` and `email`, default `["displayName"]`). Only with `hosting: "agent"` and an `agent` block. Part of the approval digest when present. See [Users and identity](#users-and-identity).                                                                                                                         |
| `userSurface`    | How end users reach the plugin. Only `web`: `{ defaultSubdomain, accessMode?, root? }` — the subdomain Lamaste offers for the plugin's own site (a DNS label, not reserved, not `agent-…`), its access mode (`authenticated`, the default, or `restricted`; never public) and the directory of the server package holding the shell (`root`, default `web`). Only with `identity`. The shell's files enter the approval digest. See [Web surface](#web-surface). |

There is no port in the manifest: Lamaste assigns it when the plugin is hosted.

**Routes are unique.** A plugin's route — its name without a trailing `-server` or `-agent` — belongs to one installed plugin: installing another plugin with the same route is refused (`409`, `code: "route_taken"`, with `route` and `owner`). Plugins installed before the rule that share a route keep it for the one installed first; the others hold no route and can be uninstalled but not hosted (`409`, `code: "route_conflict"`) until they are reinstalled under a route of their own.

**Pinned at install.** Installing (or staging an update of) a plugin with `agent.package` reads the agent package's integrity from the registry the panel installs from (`npm view <package>@<version> dist.integrity`, authenticated with the panel's [registry credential](registry-and-oidc.md) when one is configured) and pins `{ package, version, integrity }` with the plugin: the approval covers it and the agent installs only a tarball that matches. A version that is not semver without build metadata, an agent package not published at the plugin's version (`400`) or a registry without a SHA-512 integrity for it is refused.

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

**Update** (`POST /api/plugins/:name/update`, [Lifecycle Hooks](lifecycle-hooks.md#updating-a-plugin)) of a hosted plugin installs the new agent half first: `relay install:pre-tunnel` → `agent install:pre-tunnel` (through the tunnel) → `install the new agent half` (the helper switches `current` and keeps the previous version; Lamaste waits until it answers through the tunnel) → `install the new version` (the relay package) → `agent install:post-tunnel` → `relay install:post-tunnel` → `serve the new web tree` (a plugin that owns a site, [Serving the tree](#serving-the-tree)). A failure after the install job was dispatched runs `restore the previous version` and `activate the previous agent half` (an `app-activate` job naming the version the hosting recorded). The hosting must be `active` and its agent enrolled (`409` otherwise) and eligible for the new version, and push install must allow `update`. A version may not switch, under a hosting, between an agent half installed by hand and one Lamaste installs, nor drop the agent half (`400` — clear the hosting first).

Every app job is signed by the relay with its signing key when it is created, and the agent's helper runs only what the relay signed ([Signed app jobs](app-host.md#signed-app-jobs)). While the relay's signing key is unusable no app job is created and the step fails.

### Host facts

Each agent reports its host on its sync when the facts change, when the relay does not hold them, and once a day: `PUT /api/agents/me/host-facts` (agent certificates only; 10 per minute, 4 KiB). What the relay holds it tells the agent in every [`GET /api/tunnels/agent-config`](tunnels.md#get-api-tunnels-agent-config) answer: `hostFactsHash`, the SHA-256 of the facts stored on the agent's record (`hostFactsHash` in `@lamalibre/lamaste`, the same function the agent hashes its own with), `null` when it stores none. When that is not the hash of the agent's facts, the sync reports them whatever it last reported — so an agent enrolled again on its label (a new record, without host facts) or a relay restored from a backup can host again after one sync, not a day later. Behind a relay that does not send the field, the agent reports as before.

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

The relay keeps them on the agent's record (`hostFacts`, `hostFactsAt`; `GET /api/certs/agent`), re-validated on every read. The panel shows them on the Certificates page and in the host dialog. The agent asks its helper only when the helper file changed or a day passed (sudo logs every run); the pinned key is read on every sync, so a re-pin is reported at once. A panel older than 4.3 answers `404`, which the agent logs as a warning. `sync.log` records `host facts reported` for a change, and `host facts reported again (the relay held other facts or none)` for facts the relay did not hold.

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

For a plugin with `agent.package`, each agent's host facts are checked: it reported them at all; `agent.requires.os`; `agent.requires.node` against the helper's Node.js; Linux with systemd; the helper enabled at protocol 2 or later (4.4; a 4.3 helper speaks 1); the relay's signing key usable and the one the agent's helper has pinned (`relayKid`); declared system packages only on Debian or Ubuntu. For an agent half installed by hand every agent is eligible — nothing is checked. Hosting and updating check it again (`409`, `code: "agent_not_eligible"`, with the `reasons`). Admin only.

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

What a version brings that Lamaste runs or installs — relay hooks and the agent half — and, when it declares them, its [identity block](#the-identity-block) and its [web tree](#the-web-tree) are approved with one digest ([Approval](lifecycle-hooks.md#approval)); for the agent half it covers the package, version, tarball integrity, service and system packages. Hosting waits for it (`409`, `code: "hooks_not_approved"`), and so do the plugin's users: its audience is sent to the agent half, and its user surface served, only while the installed version is approved. `GET /api/plugins/:name/hooks` shows what is to be approved as `agentHalf`:

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

An update whose agent half differs waits for approval like a changed hook set: `pendingUpdate` is `{ version, digest, stagedAt, relay, agentHalf, settings, identity, web, approvalRequired, autoApproveWithheld }` (`relay` and `agentHalf` are `null` when the version brings none, and `digest` when it brings no relay hooks, no agent half, no identity block and no web surface; `settings` is how it changes the [settings schema](#in-the-plugin-list-and-the-update-preview), outside the digest; `identity` how it changes the [identity block](#the-identity-block), inside it; `web` its [web tree](#the-web-tree) — `{ before, after, changes }`, the installed tree's digest, the staged one's `{ sha256, files, totalBytes }` and what changes by path — inside it). `approvalRequired` says why it waits, never empty: `[{ code, reason }]` with `digest.unapproved` (what it brings is not what was approved), `settings.secret-to-plain` (below) and `identity.changed` ([below](#the-identity-block)), each with a sentence. **Auto-approve** covers a new version and tarball of the same agent half — what every release brings — and is **withheld** when the version brings an agent half where there was none, changes the agent package, adds system packages, or changes the service entry or memory limit: those run as root on the agent and wait for an administrator. `autoApproveWithheld` says why, in sentences; the audit log records `hooks.auto-approve.withheld` with the sentences (`reasons`) and a stable code for each (`codes`: `agent-half.added`, `agent-half.package`, `agent-half.system-packages`, `agent-half.entry`, `agent-half.memory-max`, `web.changed`, `settings.secret-to-plain`, `identity.changed`), and the administrators are notified. It is also withheld when the version's **web tree** changes or appears (`web.changed`): publisher code served to every user of the plugin on the relay's own domain is approved by a person.

**A secret turned plain always waits for an administrator.** Settings stay outside the digest, but an update that turns a secret setting into a plain one (`secretToPlain`) waits for approval — whatever is typed into the field next would be kept on the relay and shown in clear, which a release must not decide alone — even when its digest is already approved, when the plugin brings neither relay hooks nor an agent half Lamaste installs, and whether or not auto-approve is on (when it is, `autoApproveWithheld` and `hooks.auto-approve.withheld` name it as well). It is the same pending update, shown and approved the same way, and one approval covers everything it waits for: `POST /api/plugins/:name/hooks/approve` with the digest it shows, or with `{ digest, version }` — `{ version }` alone when it has no digest ([Approval](lifecycle-hooks.md#post-api-plugins-name-hooks-approve)). Approved, the version is fetched again and must still have that digest and turn no other secret plain than those shown (`409` otherwise). `plugin.update.awaiting-approval` and the update's `hooks.approved` carry the codes of what it waited for (`codes`), and the administrators are notified with the reasons. Any other update that needs no approval — no relay hooks and an agent half installed by hand, or a version whose digest is already approved — runs at once, whatever else it does to the settings.

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

The agent half reads its plugin config — `LAMASTE_APP_CONFIG` for an agent half Lamaste installs, the file above for one installed by hand (`LAMALIBRE_LAMASTE_APP_PLUGIN_CONFIG` by convention) — and verifies every request on `/admin/*` with `createCallerAssertionVerifier` from `@lamalibre/lamaste/agent`, which re-reads the file when a signature does not verify, so a rotation needs no restart. It listens where `agentHalfListenTarget` says: for an agent half Lamaste installs, systemd holds the port in a socket unit and passes the listening socket (descriptor 3), so the port stays bound while the agent half restarts or is updated and no other local process can take it in between — such an agent half must listen this way, and one that binds its port itself fails with `EADDRINUSE`; for one installed by hand, the config's port on `127.0.0.1` ([App Host](app-host.md#writing-an-agent-half)). Every answer it gives a verified request carries the responder signature ([below](#authentication-between-the-relay-and-the-agent-half)):

```js
import {
  agentHalfListenTarget,
  createCallerAssertionVerifier,
  createHealthHandler,
  responderHeaderFor,
} from '@lamalibre/lamaste/agent';

const verifier = createCallerAssertionVerifier({ configPath, plugin: 'market-indicators' });
const health = createHealthHandler({ verifier, check: () => db.isOpen() });
// systemd's socket (fd 3) for an agent half Lamaste installs, else 127.0.0.1:<port>:
await app.listen(agentHalfListenTarget({ port: await verifier.port() }));

// GET /admin/health — what the relay's health monitor probes:
const out = await health.handle({ method, url, headers, body: rawBody });
res.writeHead(out.status, out.headers).end(out.bodyText);

// each of the plugin's own /admin routes:
const result = await verifier.verify(req.headers, req.method, req.url);
if (!result.ok) return reply.code(401).send({ error: result.reason }); // no responder header
// result.payload.caller is { type: 'admin' }, { type: 'agent', label } or { type: 'lamaste' }
reply.headers(responderHeaderFor(result, 200)).code(200).send(page);
```

## The forwarded admin API

Once the plugin is enabled and hosted, the panel answers `/api/<route>` and `/api/<route>/*`:

- **Authentication** is the panel's: an administrator certificate, or an agent certificate holding one of the plugin's declared capabilities. `plugin:<route>:host` does not admit calls — hosting the application is not using it. `403` otherwise.
- **Mapping:** `/api/<route>/<rest>?query` → `http://127.0.0.1:<port>/admin/<rest>?query` on the relay's loopback, the relay end of the internal tunnel. Only `/admin/*` of the agent half is reachable; its `/app/*` (the user surface) is not, and neither is anything Lamaste keeps for itself: a path whose segment after `/admin` — percent-decoded until it no longer changes (at most three rounds; one that still decodes, or does not decode, counts as reserved), lower-cased and stripped of everything but `a-z` and `0-9` — **starts with** `hooks` (Lamaste's lifecycle hook calls), `settings` (where Lamaste writes the plugin's [settings](#between-the-relay-and-the-agent-half)) or `identity` (the identity feed Lamaste sends). `/api/<route>/Settings`, `/api/<route>/%2573ettings`, `/api/<route>/settings.json` and `/api/<route>/hooks-v2/x` all answer `404` and reach nothing, whatever the agent half's router would make of them — so an agent half's own routes cannot be named so. Nor does the forwarder reach the agent half's `/admin/app` or anything under it: on the panel `/api/<route>/app` and `/api/<route>/app/*` are the plugin's user surface (for its users, admitted by a relay assertion Gatekeeper signs — never by a certificate), whose routes win over the forwarder's as static segments win over a wildcard; an agent half keeps no admin routes there. A path segment with an encoded `/` or `\` is refused (`400`).
- **Request hooks:** a plugin's approved `request:pre-forward` / `request:post-forward` hooks run on the routes they name; a plugin whose relay hooks are not approved is refused (`503`, `code: "hooks_not_approved"`). See [Lifecycle Hooks](lifecycle-hooks.md#request).
- **Caller assertion:** `X-Lamalibre-Caller: <base64url(payload)>.<base64url(hmac)>` — payload `{ v: 1, plugin, caller, method, path, iat, nonce }`, HMAC-SHA256 with the installation secret, valid 60 seconds (5 seconds of clock skew), nonces refused on a second sight. A forwarded request streams, so its assertion carries no body hash ([below](#authentication-between-the-relay-and-the-agent-half)).
- **The answer must authenticate itself:** before the client sees a status, a header or a byte, the forwarder checks the answer's `X-Lamalibre-Responder` (the `-` form, over the request's nonce and the answer's status). An answer without a valid one — from whatever took the port while the hosting agent was away, or from an agent half built against a core older than 4.4 — is `502` with `reason: "app"` (or the `tunnel:down` fallback while the plugin is down), so nothing but the agent half can serve the plugin's pages or API.
- **Streaming:** request and response bodies are piped, never buffered; `text/event-stream` responses pass through unbuffered (the forwarder tells nginx `X-Accel-Buffering: no` itself — the only `X-Accel-*` header the panel ever sends). The tunnel's body limit (`maxBodySizeMb`, default 10) is enforced: a larger `Content-Length` is `413` before anything is sent, and a chunked body that grows past it is cut off.
- **Timeouts:** `504` when the agent half has not sent its headers after 30 seconds; a response body (not an event stream) that stays silent for five minutes is cut off.
- **Headers:** the caller's `Cookie` and `Authorization`, nginx's `X-SSL-Client-*`, anything under `X-Lamalibre-*` or `Remote-*`, hop-by-hop headers, and the headers that make some frameworks take a request for another method or path than the one the caller assertion signs — `X-HTTP-Method-Override`, `X-HTTP-Method`, `X-Method-Override`, `X-Original-URL`, `X-Rewrite-URL`, `X-Forwarded-Prefix`, `X-Forwarded-Uri`, `X-Original-Method` (core `METHOD_URL_OVERRIDE_HEADERS`; no request hook may set them either) — never reach the agent half. From the application, `Set-Cookie`, `Service-Worker-Allowed` and `Clear-Site-Data` (an answer must not widen a service worker's scope over the panel or wipe the panel's storage), anything under `X-Lamalibre-*` (the responder signature is the relay's to check) and anything under `X-Accel-*` (nginx obeys `X-Accel-Redirect` and its kin from the panel's port — an application must never have nginx serve a file or an internal location) never reach the client.
- **No service workers:** a request that fetches a service worker's script (`Service-Worker: script`, any value) is refused with `403` before it enters the tunnel — no plugin installs a service worker on the panel's origin. A plugin's admin bundle runs in the panel's own document; that is a boundary of its own until plugin UIs are isolated in sandboxed frames ([Security Model](../01-concepts/security-model.md), 5e).
- **Failures:** `502` with `reason: "tunnel"` when nothing listens on the port (the agent is not connected), `502` with `reason: "app"` when the connection drops before the headers or the answer does not authenticate itself (the tunnel is up, the agent half is not — or something else holds the port), `503` while the plugin is disabled or not yet hosted. **Once the health monitor has marked the hosting down, nothing is forwarded**: an authorized request is answered as a request into a dead tunnel — `502` with the health's reason (`{ "error": "The hosting agent is unreachable", "reason": "tunnel" }`, or `"The agent half is not responding"`, `"app"`) — without a connection to the port, whatever holds it. While the plugin is down, its `tunnel:down` hook's fallback answers instead of the 502.
- **Logging:** one line per request — plugin, caller, method, path without its query, status, duration. Never a body.

## Authentication between the relay and the agent half

The internal tunnel ends on loopback ports: on the relay, the port chisel listens on while the hosting agent is connected; on the agent, the port the agent half listens on. Every process on either machine can reach them — and **take** them: on the relay while the agent is offline, on the agent while an agent half installed by hand restarts (for one Lamaste installs, systemd holds the port in a socket unit, so it stays bound across restarts and updates — [App Host](app-host.md)). So neither end trusts the network position, and **anything that takes a tunnel's loopback port can serve nothing and open no secret**. All three mechanisms below are keyed with the hosting's installation secret, which only the relay's panel, the hosting agent's account and the agent half's own account hold. They do not keep the relay from _sending_ to such a port — what reaches it, and for how long, is under [When the hosting agent is offline](#when-the-hosting-agent-is-offline).

**Requests carry a caller assertion bound to their body.** Lamaste's own calls with a body — settings changes, hook calls, the [identity feed](#the-identity-feed) — carry `bodySha256` in the assertion: the SHA-256 of the exact body bytes, 64 lower-case hex characters. `createSettingsHandler` (`PUT`), `createAgentHookHandler` and `createIdentityHandlers` require it and compare it with the bytes received; an assertion lifted onto another body is refused (`401`, reason `wrong_body`) without burning its nonce, so the true request still verifies. The handlers therefore need the body **exactly as received** — a `Buffer` (or `Uint8Array`) or a string; an object a framework already parsed is refused with `400` "The body must be passed as received". With Fastify, register a `parseAs: 'buffer'` content-type parser for these routes; with `node:http`, collect the chunks. Forwarded requests stream, so theirs carries no hash. Verifiers built before the field existed ignore it.

**Answers carry a responder signature.** Every answer an agent half gives to a request whose assertion verified carries

```
X-Lamalibre-Responder: base64url(HMAC-SHA256(secret,
  "lamaste.responder.v1\n" + nonce + "\n" + status + "\n" + (bodySha256 | "-")))
```

keyed with the secret that verified the request (the previous one during a rotation), over the request's assertion nonce, the decimal HTTP status and — for the buffered answers to Lamaste's own calls — the SHA-256 of the exact answer body in lower-case hex; `-` for answers to forwarded calls, which stream. The relay checks it in constant time before it believes or passes on anything:

| Who checks                                           | Form | Without a valid signature                                                  |
| ---------------------------------------------------- | ---- | -------------------------------------------------------------------------- |
| `callAgentHalf` (settings, the identity feed)        | body | failure `unauthenticated`; a settings change answers `502 unauthenticated` |
| `callAgentHalfHook` (agent hooks through the tunnel) | body | failure `unauthenticated`, a failed hook                                   |
| The health monitor (`GET /admin/health`)             | body | a failure with reason `app`, however the port answered                     |
| The forwarder (every forwarded `/admin/*` answer)    | `-`  | `502` with `reason: "app"` before anything reaches the client              |

**Every `/admin/*` response of an agent half to a verified request must carry the header**, and core's helpers produce it:

- `createSettingsHandler`, `createAgentHookHandler` and `createHealthHandler` return `{ status, body, bodyText, headers }`: send `status`, `headers` (`content-type` and the responder header) and **`bodyText`, byte for byte** — the signature covers those bytes; `body` is the parsed answer, for inspection, and re-serializing it would break the signature;
- **`createHealthHandler({ verifier, check? })`** answers `GET /admin/health`: `200 { ok: true }`, or `503 { ok: false }` when `check` returns false, throws or rejects (its message is not passed on); any verified caller may ask;
- **`responderHeaderFor(verified, status)`** gives the header (the `-` form) for the agent half's own routes — its pages, `panel.js`, its API — to merge into every answer to a verified forwarded request, with the status it sends.

Answers given before or instead of a verification — a `401` for a bad assertion, a `404` or `405` no handler matched, the `400` for a parsed body — carry no responder header: there is no verified request to bind it to, and the relay treats them as not the agent half's.

**Secret settings travel sealed** to the one request that carries them ([Between the relay and the agent half](#between-the-relay-and-the-agent-half)).

**Agent halves built against `@lamalibre/lamaste` 4.3 must be rebuilt** against this version: an agent half that does not sign its answers is down (`app`) to the health monitor, its pages and API answer `502`, and its settings and hooks fail as `unauthenticated`; one that expects secrets in clear refuses sealed ones.

## Health

Every 10 seconds, for every active hosting of an enabled plugin, the panel connects to the relay-loopback port and then calls `GET /admin/health` on the agent half with a caller assertion naming Lamaste itself (`{ "type": "lamaste" }`). Only a `2xx` answer authenticated with the responder signature (`createHealthHandler`) counts: whatever squats the port without the installation secret is not the plugin's application, however it answers. A refused connect means the **tunnel** is down; a failed or unauthenticated health call means the tunnel is up and the **application** is down. The state changes to `down` after three consecutive failures of the same reason and to `up` after two consecutive successes; each transition is persisted (`health` on the hosting record, with `reason`, `since`, `lastError`) and runs the plugin's `tunnel:down` / `tunnel:up` relay hook. While the state is `down` neither forwarder sends anything to the port (the admin API answers `502` with the reason, or the hook's fallback; the user surface `503`); the probes go on, so the hosting comes up again as soon as the agent half answers them.

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

**What reaches the port meanwhile.** While the hosting agent is offline, its internal tunnel's port on the relay's loopback is free for any local process to take. Whatever takes it serves nothing — every answer must carry the responder signature — and opens no sealed secret, but the relay still _sends_ to it what it forwards:

- **The user surface forwards nothing while the hosting is `down`**: a user's request is answered `503` by the panel, so it never reaches the port. The health monitor marks the hosting down after three failed probes in a row, 10 seconds apart — a squatter cannot pass one — so a user's request (its path, query and body, and the `userId`, username and roles in its caller assertion) can reach a squatter only in that first window of about 30 seconds after the agent went away.
- **The admin API forwards nothing while the hosting is `down` either**: an administrator's or agent's request is answered `502` with the reason (or the plugin's `tunnel:down` fallback) without a connection to the port. Its request — method, path, query, body and caller assertion — can reach a squatter only in the same first window of about 30 seconds; nothing the squatter answers reaches anyone.
- **Lamaste's own calls** (the health probe, settings reads, hook calls, the identity feed) do not go through the forwarders and keep reaching the port — the health probe has to, to see the agent half come back — with their bodies bound to their assertions and settings secrets (and the feed's changes) sealed; a squatter can replay none of them.

## Settings

A plugin with an agent half may declare **settings**: what an administrator configures for it — an API key, a schedule, a region. The **agent half is the system of record**: it stores the values in its own data directory and answers `GET` and `PUT /admin/settings` for Lamaste alone. The panel shows them as a form, checks a change and carries it to the agent half through the internal tunnel; it keeps a cache of the non-secret values and of _when_ each secret was set — never a secret's value. A secret exists on the relay in clear only in the memory of the request that carries it, and crosses the tunnel sealed to that request, so not even whatever takes the tunnel's port can read it ([Security Model](../01-concepts/security-model.md), 5e).

Settings are not part of the [approval digest](#approval): they declare data, not code, and nothing they change runs with more privilege — but an update that turns a secret setting into a plain one waits for an administrator's approval all the same ([Approval](#approval)). Because the agent half holds them, they can be changed only while its hosting is up; while it is offline the panel shows them from its cache, read-only.

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

Only in a manifest with an `agent` block — the agent half stores the values (`400`, "settings needs an agent block"). Both the block and its fields are strict: an unknown property is refused. Text an administrator reads — `label`, `description`, an option's `value` and `label`, a string `default` and `pattern` — refuses C0 and C1 control characters and the bidirectional marks, embeddings, overrides and isolates (U+061C, U+200E/F, U+202A–U+202E, U+2066–U+2069), which could make a field read as something it is not ("Contains control characters").

| Property        | Meaning                                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | An integer of at least 1, bumped by the plugin when its fields change. Every change the relay sends names the installed manifest's version, and an agent half running another one refuses it (`409`, `schema_mismatch`) — during an update, until both sides run the same version.                              |
| `fields`        | 1–50 fields; keys are unique.                                                                                                                                                                                                                                                                                   |
| `key`           | A lower-case letter, then letters and digits, at most 64 characters (`^[a-z][A-Za-z0-9]{0,63}$`).                                                                                                                                                                                                               |
| `label`         | 1–100 characters. `description` (optional): at most 500.                                                                                                                                                                                                                                                        |
| `type`          | `string`, `secret` (a non-empty string the panel never shows), `integer` (a safe integer), `number` (finite), `boolean` or `enum`.                                                                                                                                                                              |
| `required`      | A required secret that is not set, or a required non-secret field with neither a stored value nor a default, leaves the plugin **needing configuration**.                                                                                                                                                       |
| `default`       | Never on a secret. Must itself be a valid value of the field: its type, length, range and option are checked when the manifest is validated, its `pattern` by the agent half when it reads its own manifest (`settingsFromManifest`) — the relay never runs a manifest's pattern, not even against its default. |
| `maxLength`     | `string` and `secret` only: 1–4096; 1024 when not set.                                                                                                                                                                                                                                                          |
| `min`, `max`    | `integer` and `number` only; `min` not greater than `max`.                                                                                                                                                                                                                                                      |
| `pattern`       | `string` only, at most 256 characters; must compile as `new RegExp(pattern, 'u')`. Tested **unanchored** — anchor it with `^` and `$` when it means the whole value.                                                                                                                                            |
| `options`       | `enum` only, and required there: 1–100 `{ value, label }` (a value of 1–200 characters, unique; a label of 1–100).                                                                                                                                                                                              |

**Who tests `pattern`.** The form, in the administrator's browser, and the agent half — never the panel process, and never `lamaste-server`, which runs as root on the relay: a manifest's regular expression must not be able to stall the panel or run as root. The relay validates manifests at install, at update and at every start, so the manifest schema only compiles a pattern (linear in its length) and never runs it — a catastrophic pattern with a default it does not match is checked instantly. The panel checks everything else — type, required, length, range, option — so a value that only the pattern refuses comes back from the agent half (`422`). **Validation messages never contain the value**: a secret typed into the wrong field must not come back in an error, a log line or a response. That is why settings values are checked by hand and not with zod's enum or literal schemas, whose messages repeat what they received.

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

A partial change: only the keys it names change. `revision` is the revision the administrator read. A secret goes in `secrets`, every other field in `values` (each in the wrong one is refused per key), and the body holds nothing else. `null` puts a non-secret field back to its default — or unset, when it has none — and clears a secret; both are refused for a field that must have a value. At most 2 MiB (`413`); 30 requests a minute. The change is writable while the hosting is `active` and its health is not `down` — `unknown`, right after hosting, included: an answer that does not authenticate itself as the agent half's is refused, so nothing else on the tunnel's port can take a change.

The panel checks the change against the installed schema — without `pattern` — and sends it to the agent half (`PUT /admin/settings`, 15 s), each secret sealed to the call, and the agent half's authenticated answer decides: on success the panel caches the agent half's new state, records the change and answers `200` with the settings as `GET` returns them (`source: "live"`). A change that changes nothing stores nothing and answers the settings as they are. Changes and reads of one plugin's settings run one at a time, so a slow read cannot put back what a change replaced.

| Status | `code`                 | When                                                                                                                                                                                                                                                         |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | —                      | The panel refused it: `errors`, a message per field key (`_` for the body as a whole, and for names the schema does not know — counted, `"2 unknown settings"`, never named)                                                                                 |
| 404    | `no_settings`          | The plugin declares no settings (without a code: it is not installed)                                                                                                                                                                                        |
| 409    | `operation_running`    | An operation of the plugin runs (`operationId`) — an update may be changing the schema                                                                                                                                                                       |
| 409    | `revision_mismatch`    | The settings changed since they were read; `revision` is the current one. Read them again and make the change on them                                                                                                                                        |
| 409    | `schema_mismatch`      | The agent half runs another version of the settings schema — let the plugin's update finish                                                                                                                                                                  |
| 409    | `conflict`             | The agent half refused it as conflicting, for another reason                                                                                                                                                                                                 |
| 422    | —                      | The agent half refused it: `errors` per field — its `pattern`, its own schema, or a sealed secret that did not open ("Could not be decrypted")                                                                                                               |
| 502    | `settings_unsupported` | The agent half does not answer `/admin/settings` (`404`) — it predates settings; update the plugin                                                                                                                                                           |
| 502    | `refused`              | Nothing answers on the internal tunnel's port                                                                                                                                                                                                                |
| 502    | `unauthenticated`      | The answer did not carry a valid responder signature: something else may hold the tunnel's port, or the agent half was built against an older `@lamalibre/lamaste` and must be rebuilt. The change may or may not have been stored — read the settings again |
| 502    | `invalid`, `other`     | The agent half answered too large a body or in another shape (reload the settings to see what it stored), or could not be reached                                                                                                                            |
| 502    | `agent_half_error`     | The agent half answered another status (`status`)                                                                                                                                                                                                            |
| 503    | `hosting_offline`      | The plugin is not hosted, its hosting is not `active`, or its health is `down` — with `hosting` as in `GET` (`null` when not hosted)                                                                                                                         |
| 504    | `timeout`              | No answer within 15 s — the change may or may not have been stored; read the settings again                                                                                                                                                                  |

Once the plugin and its settings block are found, the checks run in this order: the body (`400`), a running operation (`409`), the hosting (`503`), then the agent half. A refusal answers `{ error, code?, errors?, revision?, operationId?, hosting?, status? }`, built from what Lamaste found and never from the request body. The agent half's per-field messages are passed on only under the keys of the installed schema (or `_`), and only when they are messages Lamaste's own validation produces — the fixed ones (`Is required`, `Does not match the required format`, …) and the templated ones (`Must be at most 64 characters`, `Must be at least 0`, `2 unknown settings`), matched exactly; anything else reads `Invalid value` (`normalizeSettingsErrorMessage` in `@lamalibre/lamaste`). The agent half is Lamaste code that never repeats a value, but the relay does not answer an administrator with text it cannot vouch for.

A stored change is recorded in the [audit log](audit-and-notifications.md) as `plugin.settings.updated` with key names only — `changed`, `cleared`, `secretsSet`, `secretsCleared` — the new `revision` and the certificate serial. A change whose answer was lost (`504 timeout`, `502 unauthenticated` or `invalid`) is remembered by its key names; when a later read finds the agent half at exactly its revision, changed in those keys only, it is recorded then, with `confirmedLater: true`.

**Changes made outside Lamaste.** Only Lamaste writes settings — the forwarder reserves `/admin/settings*` — so every revision of the agent half's should be one Lamaste wrote. The relay remembers the last one it wrote or adopted; a read that finds any other revision — higher (a change by whatever holds the installation secret on the agent) or lower (files put back from a backup) — records `plugin.settings.changed-outside-lamaste` in the audit log with the names of the settings that differ from its cache (`changed`, `secretsChanged`), `fromRevision`, `revision` and the agent, notifies the administrators with a warning, and then adopts the revision, so each such change is reported once. Never a value.

#### In the plugin list and the update preview

`GET /api/plugins`, `GET /api/plugins/:name` and the install response carry, for a plugin that declares settings, `settings: { configured, missing, syncedAt }` in place of its schema — no values — from the relay's cache, or from the schema alone while the relay never read the settings (`syncedAt: null`). The Plugins page shows **Needs configuration** from it.

An update's preview — `pendingUpdate.settings`, in `GET /api/plugins/:name/hooks` and the update response — says how the version changes the schema, `null` when neither version declares settings:

```json
{
  "added": [{ "key": "endpoint", "type": "string" }],
  "removed": [{ "key": "verbose", "type": "boolean" }],
  "retyped": [{ "key": "token", "from": "secret", "to": "string" }],
  "newRequired": ["endpoint"],
  "secretToPlain": ["token"]
}
```

`retyped` are fields whose type changes; their values are dropped on both sides, never converted. `newRequired` are fields required without a default in the new version that were not before (absent, optional or with a default), and required fields that are retyped. `secretToPlain` are fields that are secrets now and plain values after the update: their secrets are dropped, never moved into plain storage — but whatever is typed into them next is stored on the relay and shown in clear, so **such an update always waits for an administrator's approval** (`settings.secret-to-plain` in `approvalRequired`, see [Approval](#approval)), its digest approved or not and auto-approve or not. The panel and `lamaste-server plugins hooks|update` show the diff next to what the update asks to approve and why it waits — the panel and the CLI warn about `secretToPlain` — but it is not part of the digest. After the update the plugin needs configuration until the newly required fields are filled.

### Between the relay and the agent half

The relay calls the agent half with `callAgentHalf` (`@lamalibre/lamaste`, also exported from `@lamalibre/lamaste/server`): one JSON request to `http://127.0.0.1:<port>/admin/…` — the relay end of the internal tunnel — with a caller assertion naming Lamaste itself (`{ "type": "lamaste" }`) that binds the body's SHA-256, answered with whatever status the agent half gives once the answer carries a valid responder signature over that status and its exact body ([Authentication](#authentication-between-the-relay-and-the-agent-half)). It calls only paths under `/admin/` without `.` or `..` segments, with `GET`, `PUT`, `POST` or `DELETE`, and throws before sending anything otherwise; it sends a body as `application/json` — `body` may be a function of the assertion's nonce, chosen before anything is signed, which is how a change seals its secrets to the one call — bounds the time and the response size, and resolves `{ ok: true, status, body }` (the parsed JSON, or `null`) or `{ ok: false, code, error }` — `refused` (nothing listens), `timeout`, `invalid` (a response over the size limit), `unauthenticated` (no valid responder signature: not the agent half, or one built against an older core) or `other` — with an error that never contains the request body. The hook call `callAgentHalfHook` is built on the same exchange.

| Call                          | Body                                                              | Answer                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/settings`         | —                                                                 | `200` the state                                                                                                                                                                                                                                                                                                                                                                                          |
| `PUT /admin/settings`         | `{ schemaVersion, baseRevision, values, secrets }`, at most 2 MiB | `200` the new state; `409 { error, code: "schema_mismatch" }`; `409 { error, code: "revision_mismatch", revision }`; `422 { error: "Invalid settings", errors }` (a sealed secret that does not open: "Could not be decrypted"); `400` a body that is not JSON or not of that shape, or one passed parsed; `401` an assertion that does not verify or binds another body (`wrong_body`); `413` too large |
| `POST /admin/settings/reload` | —                                                                 | `200` the state, read again from the files                                                                                                                                                                                                                                                                                                                                                               |

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

`values` are the explicitly stored non-secret values — no defaults; `secrets` names the secrets that are set, and when — never a value; `setAt` must be an ISO 8601 UTC timestamp as `Date.prototype.toISOString` writes it (`2026-10-16T10:00:00.000Z`), so not even that field can carry free text. In a change, `schemaVersion` is the relay's installed manifest's, `baseRevision` the revision the administrator edited, `values` the non-secret change the panel validated and `secrets` each secret **sealed** (`null` clears). Bodies and responses are 2 MiB at most — the largest valid change, 50 fields of 4096 characters that JSON escapes to six bytes apiece, is about 1.23 MB. The relay parses every state with `parseAgentHalfSettingsState`, which builds a fresh object of the contract's fields: nothing else the agent half sent — a secret's value in particular — survives into the cache.

**Sealed secrets.** Each secret of a change crosses the tunnel as `{ "v": 1, "iv": "<base64url, 12 bytes>", "ct": "<base64url ciphertext and 16-byte tag>" }` — AES-256-GCM under a key derived from the installation secret (HKDF-SHA256 over its 32 bytes, salt `lamaste/settings-secrets/v1`, info the plugin's route), a random IV per value, and as additional data the JSON array `[plugin, nonce, key, baseRevision]`: the plugin, the call's assertion nonce, the field and the revision the change was made on. `encryptSettingsSecret` and `decryptSettingsSecret` in `@lamalibre/lamaste` are the two halves; the relay seals with the secret it signs the call with, and the agent half opens with the secret that verified it (`decryptSettingsSecret` on the verify result — the secret never leaves the verifier). A sealed secret opens for no other plugin, call, field or revision; one that does not open is a `422` for its key, and an error never repeats it. Whatever takes the tunnel's port receives no secret in clear — the non-secret values of a change, which the relay stores in clear anyway, are not sealed.

Only Lamaste: a caller assertion that does not verify is `401`, one naming an administrator or an agent `403`; another path under `/admin/settings` is `404`, a method a path does not take `405`. The **forwarder reserves `/admin/settings`** and everything under it as it reserves `/admin/hooks/*`: `/api/<route>/settings`, `/api/<route>/Settings` and `/api/<route>/%73ettings/x` all answer `404` and reach nothing. No forwarded caller — an administrator, or an agent holding one of the plugin's capabilities — reads or changes the settings behind the panel's validation, and the relay's cache cannot drift from the agent half. An agent half's own admin routes cannot live there.

`POST /admin/settings/reload` is for a restore that puts older files in place while the agent half runs; Lamaste does not call it today, and since the forwarder reserves it nothing else can. An agent half that is restarted after a restore reads its files when it starts.

### In the agent half

`@lamalibre/lamaste/agent` holds the store and the handler, so that no plugin reimplements how a secret is stored:

- **`settingsFromManifest(manifest)`** — the `settings` block of the agent half's own copy of its manifest (bundled with it), validated — here each string default is also tested against its field's `pattern`, which the relay never runs; throws `ManifestValidationError` when it is missing or invalid. The agent half checks values against this schema, not the relay's.
- **`createSettingsStore({ dataDir, settings })`** — the store over two files in `dataDir`, which must exist: for an agent half Lamaste installs, `LAMASTE_APP_DATA_DIR`, the only directory its unit may write ([App Host](app-host.md)). One store per process. `load()` reads and reconciles the files and must run before anything else; then `state()` is what `GET` answers, `values()` the values the plugin runs with (defaults overlaid by the stored values, never a secret), `secret(key)` a secret's value for the agent half's own use (`undefined` when it is not set), `configured()`, `update(change)`, `reload()`, and `onChange(listener)` — called with the new state after every update and reload, returning its unsubscribe function; a listener that throws does not fail the update, which is stored.
- **`createSettingsHandler({ verifier, store })`** — answers `/admin/settings` as above. Framework-agnostic, like `createAgentHookHandler`: pass `{ method, url, headers, body }` — the body **as received** (a `Buffer` or a string; a parsed object is refused `400` on `PUT`, since the assertion binds the bytes) — and send the `status`, `headers` and `bodyText` it returns, `bodyText` byte for byte (the responder signature covers it). It opens each sealed secret with the verified request and hands the store the plaintext. No answer carries a secret's value; a store that fails is `500` without its message.

| File                      | Contents                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<dataDir>/settings.json` | `{ v: 1, schemaVersion, revision, values: { <key>: { type, value } } }` — each non-secret value with the type of the field it was stored for; written on every change |
| `<dataDir>/secrets.json`  | `{ v: 1, secrets: { <key>: { value, setAt } } }` — written only when a secret changes                                                                                 |

Both are 0600, owned by the account the agent half runs as, and written atomically: an exclusive temp file in the same directory (`wx` — never opened through an existing file or link), `fsync`, rename, `fsync` of the directory. A symbolic link — or anything but a regular file — where either belongs is refused, on read (checked, then opened with `O_NOFOLLOW`) and on write. A missing file is empty; a malformed one, or one over 4 MiB, is an error that names the file and never repeats its contents. A secret never goes into `settings.json`.

**Reconcile.** `load()` and `reload()` reconcile the stored values with the agent half's own schema. A key the schema no longer knows is dropped; so is a value recorded for another type than its field has now — a **retyped value is dropped, never converted**: a secret whose field became a string leaves `secrets.json` and never lands in `settings.json`, and a string whose field became a secret leaves `settings.json` — and so is a value that no longer passes its field's checks, pattern included. A file is rewritten when something was dropped from it, and `settings.json` also when it records another `schemaVersion` than the agent half's — after an update that dropped only a secret, or nothing, it names the new schema too; the revision stays.

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

// in the agent half's router, for /admin/settings and /admin/settings/* (the body as received):
const out = await settingsHandler.handle({ method, url, headers, body: rawBody });
res.writeHead(out.status, out.headers).end(out.bodyText);

// where the plugin uses them:
const { schedule, retries } = settings.values();
const apiKey = settings.secret('apiKey'); // undefined until an administrator sets it
if (!settings.configured()) pauseSync(); // required settings missing
```

### The relay's cache

`state.db` holds one row per plugin in `plugin_settings` (migration `0012`): the agent half's schema version and revision, the non-secret values it stored — for the keys the installed schema knows, and only values that still suit their field — `{ key: setAt }` for the secrets it holds, whether it is configured and what is missing, when the relay read them (`synced_at`), and its provenance: the revision Lamaste last wrote or adopted (`lamaste_revision`) and the key names of a change whose answer was lost (`unconfirmed_change_json`). There is no column for a secret's value. The installed manifest's `settings` block itself is kept on the plugin's row (`plugins.settings`).

The relay reads the agent half's settings after a hosting succeeds, after an update or its revert, whenever the health monitor sees the plugin come up, **once when the panel starts** (for every hosting that is active and not down, one plugin after another — the monitor resumes from the persisted health, so a plugin that stayed up sees no transition, and a change made while the panel was down would otherwise go unseen), on every live read, and from the answer to every change. A read that fails — including an answer without a valid responder signature — is logged with metadata only and keeps the row. When an update or its revert changes the installed settings schema, the row is **pruned in the transaction that writes the plugin's row**: a value or a secret stays only while its field keeps its type — a value whose field became a secret goes, and a secret whose field became a plain value is no longer reported set — and whether the plugin is configured is worked out against the new schema until the agent half reports its own. The row is deleted when the plugin's hosting is removed — a later hosting reads the settings afresh, from files the agent kept or from none — when a version without settings is installed over it, and when the plugin is uninstalled, with its registry row.

Hook inputs read the cache: a **relay hook**'s `settings` is the plugin's effective non-secret values — each stored value or its default, `{}` while the relay never read them — and an **agent hook** gets `{}`, since the agent half holds the settings itself ([Lifecycle Hooks](lifecycle-hooks.md#writing-hooks)). Neither ever gets a secret.

### Hosting, retained data and updates

- **Hosting takes no settings.** The agent half starts without them — or with the files it kept on that agent — and reports `configured: false` until an administrator fills the required fields. Secrets would otherwise wait in the relay's memory through an operation that can take minutes. Once the hosting is active the relay reads the settings, and the plugin's card shows whether it needs configuration.
- **Retained data.** The files are in the agent half's data directory, so for an agent half Lamaste installs they stay with its [retained data](#retained-data) when it is removed without purge, and come back when the same package is hosted on that agent again; the relay reads them then. A **purge** deletes them with the data directory.
- **Updates.** A version may add, remove or retype fields and bump `schemaVersion`. The new agent half reconciles the files with its schema when it starts: values of fields it no longer has are dropped, and a retyped field's value is dropped — on the relay too, whose cache keeps only values that suit the installed schema — never converted. While the two sides run different schema versions a change is refused (`409 schema_mismatch`), and while the update runs as an operation it is refused anyway (`409 operation_running`); the relay reads the settings again once the update finished or was reverted. Fields the new version newly requires leave the plugin needing configuration.

### In the panel

A plugin that declares settings gets a **Settings** section on its card on the Plugins page: a form generated from its fields — a text input for a string (its length and `pattern` checked in the browser before anything is sent), a number input with its range, a checkbox, a select of an enum's options; a secret as a masked input that is never prefilled, says when it was set, and offers **Replace** and — for an optional secret — **Clear**. A secret's input is a text input masked with `-webkit-text-security: disc` (Chrome, Edge and Safari; Firefox since 114), not a password input: browsers offer to save what is typed into a password input in their password managers whatever its `autocomplete` says (`new-password` only stops autofill), and a plugin's secret does not belong there. It keeps no form history (`autocomplete="off"`, no name), cannot be copied out, and in a browser that cannot mask it the form says the value shows as it is typed. A secret's value never enters the page's state or its query cache: the form reads the input once when it submits and empties it. A plain string field whose key or label looks like a credential (`key`, `token`, `secret`, `password`, `passwd`, `credential`) says "Stored on the relay and shown in clear — use a secret field for credentials". Only the fields that changed are sent; the panel's and the agent half's messages appear under their fields, a stale revision reloads the settings, and a timeout or an answer that did not authenticate itself reloads them to show what was stored. While the hosting is not active or is down, the form is read-only from the cache and says why ("Hosting agent vm1 is offline since … — last sync …"), and reads the settings again every 10 seconds until it can open. The card shows **Needs configuration** while required settings are missing; the host dialog lists the fields a plugin declares, with their types; an update's approval says why it waits — a secret turned plain in red — and lists how it changes the settings — fields with their types, retyped ones `from → to`, newly required ones, a warning for secrets that become plain values — and what auto-approve did not cover beyond that.

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
| `--secrets-stdin`                        | Reads one JSON object from stdin — `{ "apiKey": "…", "oldToken": null }`: secret keys only, `null` clears — at most 2 MiB. Refused when stdin is a terminal: pipe it in or redirect it from a file                                                                                                  |

```bash
lamaste-server plugins configure market-indicators --set retries=5 --clear region --secrets-stdin < secrets.json
```

Each key may be named once across the flags. The change is checked against the schema before anything is sent — without `pattern`, which the agent half tests — and a refused one prints a message per field and sends nothing. Messages name keys, never a value; an argument that could be a secret typed in the wrong place is never repeated, and names the schema does not know — on the command line or on stdin — are counted (`2 unknown settings`), never named, as the panel counts them. A secret given with `--set` is refused and, since it is now in the shell history and in sudo's log, the refusal says to rotate it. Everything a manifest, an agent half or the panel supplies — labels, descriptions, options, `setAt`, messages — is printed without control or bidirectional formatting characters.

Without flags, in a terminal (stdin and stdout both), `configure` asks for each field in turn: a secret is kept, replaced — typed into a masked prompt, never shown — or cleared; a boolean is a yes or no; an enum a choice among its options (or back to its default); a string or a number a text prefilled with the current value, empty putting it back to its default. It then lists what changes — a non-secret field with its old and new value, a secret only as set, replaced or cleared — and asks before saving. Without flags it refuses to run with `--json` or without a terminal.

Before sending, `configure` refuses what the panel would: the settings of a plugin that is not hosted, whose hosting is being set up or removed, or whose hosting is down (`hosting_offline`, with since when and the agent's last sync), or that the relay has never read (`settings_not_read`). A refusal of the panel is explained: each field's message; a stale revision (nothing was saved — run it again); a running operation (`plugins operations <name>`); a timeout or an answer that did not authenticate itself (`plugins settings <name>` shows what the agent half stored; for the latter, something else may hold the tunnel's port or the agent half must be rebuilt); an agent half that predates settings (`plugins update <name>`).

Both commands exit `0` when they did what was asked — for `configure`, saved the change, found nothing to change, or the administrator declined to save — and `1` for a usage error, a refusal, or a prompt cancelled with Ctrl-C (nothing is saved). With `--json`, `configure` prints `{ "event": "complete", "name", "changed", "cleared", "secretsSet", "secretsCleared", "settings" }` — key names, and the settings as `GET` answers them — and every failure of either command `{ "event": "error", "message", "recoverable": false, "code"?, "errors"?, "revision"?, "operationId"?, "hosting"? }`.

## Users and identity

A plugin with an agent half may have **users**: people who sign in to the relay's Authelia and use the application itself, not its admin pages. Lamaste is their directory. The plugin declares its roles; an administrator gives users (or Lamaste groups) those roles; Lamaste keeps the plugin's **audience** — who holds which role — and pushes it to the agent half through the internal tunnel, which keeps a local copy to join its data to and to show names from. On every request a user makes to the plugin, the agent half learns who it is from a signed caller assertion: the user's stable `userId`, username and roles. Nothing about users reaches a plugin that does not declare `identity`.

| Piece                             | Where                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| The plugin's roles and attributes | The manifest's [`identity` block](#the-identity-block), approved with the plugin                                                                  |
| Who the users are                 | The relay's user directory — a `userId` per user, `active`, `disabled` or `removed` ([Users API](users.md))                                       |
| Who holds which role              | [Entitlements](#entitlements-and-the-audience): Gatekeeper plugin grants with `context.roles`                                                     |
| What the agent half knows         | [The identity feed](#the-identity-feed) into its own SQLite projection                                                                            |
| Where users reach the plugin      | [The user surface](#the-user-surface): `/api/<route>/app/*` on a tunnel host bound to the plugin ([Tunnels API](tunnels.md#user-surface-binding)) |
| Who is calling, on each request   | [The user caller](#the-user-caller) in the caller assertion                                                                                       |

### The identity block

```json
"identity": {
  "roles": [
    { "id": "viewer", "label": "Viewer", "description": "Sees the dashboard" },
    { "id": "editor", "label": "Editor" }
  ],
  "attributes": ["displayName", "email"]
}
```

- **`roles`** — 1 to 32, ids unique. `id`: a lower-case letter, then lower-case letters, digits and `-`, at most 32 characters; `label`: 1–64 characters; `description`: optional, at most 200. Labels and descriptions refuse control and bidirectional formatting characters.
- **`attributes`** — what Lamaste tells the agent half about each user besides the `userId`, username, roles and status: a subset of `displayName` and `email`, no repeats; `["displayName"]` when omitted. The agent half receives nothing it did not declare.
- Only a plugin with `hosting: "agent"` and an `agent` block may declare it (`400` at install otherwise): its users reach the agent half.

The panel stores the block **normalized** — roles sorted by id, attributes sorted, the default applied — as `identity` on the plugin's entry in `GET /api/plugins` and in `plugins.identity` (`state.db`). It enters the [approval digest](lifecycle-hooks.md#approval) **only when present**, so the digest of a plugin without one is the digest it had before 4.5, byte for byte. A plugin that declares one waits for approval even when it brings no relay hooks and no agent half Lamaste installs; until its installed version is approved, it has no audience on its agent half and no user surface. `GET /api/plugins/:name/hooks` shows it as `identity: { declared, approved, block }`.

An update that **adds or removes a role**, or **widens the attributes**, waits for an administrator with the reason `identity.changed` — the update gives the plugin a new power over its users, or more about them — and **auto-approve never covers it**. Narrowing the attributes and editing a role's label or description only change the digest (`digest.unapproved`, which auto-approve may cover). The update's preview carries the change:

```json
"identity": {
  "before": { "roles": [{ "id": "viewer", "label": "Viewer" }], "attributes": ["displayName"] },
  "after": { "roles": [{ "id": "editor", "label": "Editor" }, { "id": "viewer", "label": "Viewer" }], "attributes": ["displayName", "email"] },
  "rolesAdded": ["editor"],
  "rolesRemoved": [],
  "attributesAdded": ["email"],
  "attributesRemoved": [],
  "labelsChanged": []
}
```

`null` when neither version declares a block. When the update removes roles (or the whole block), the preview also says how many role grants approving it changes — `"grantsAffected": { "rewritten": 1, "revoked": 3 }` (`null` when Gatekeeper could not be read). **A removed role stays removed**: once the version that drops it is installed and approved, the role is taken out of every grant on the plugin — a grant left with other roles is replaced by one with those, a grant left with none is revoked — and audited as `plugin.entitlement.roles-removed` (the roles, how many grants were rewritten and revoked); a later version that declares the role again finds nobody holding it. Members left with no role leave the audience (`unentitled`). Uninstalling a plugin **with purge** revokes every role grant on it; without purge they stay with the data its agent keeps.

### Entitlements and the audience

An **entitlement** is a Gatekeeper grant on the plugin — `resourceType: "plugin"`, `resourceId: <route>` — to a user (by username) or a Lamaste group, whose `context.roles` is a non-empty list of role ids the installed version declares. Nothing else makes anyone a user of the plugin: a grant without roles — the desktop's local-install grants, grants migrated from `user-plugin-access.json` — never counts. The panel checks roles against the manifest wherever a grant is created, here and in the [Gatekeeper proxy](gatekeeper.md#create-grant) (`400`, `code: "unknown_roles"` with the `unknown` ones), and stores them sorted, without repeats. One principal has one role grant per plugin: setting its roles creates the new grant first, then revokes the others.

The **audience** is the directory's users who hold at least one of the plugin's roles — the union of their own entitlements and those of the Lamaste groups they are in, restricted to the declared roles. Users whose username an earlier, removed user held hold no role until Gatekeeper has dropped what that user left there ([Users API](users.md#usernames-and-gatekeeper)). A member is carried in full; a user who leaves is a removal with its reason:

| Change                                                       | Carries                                                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `upsert`                                                     | `member: { userId, username, displayName?, email?, roles, status: "active" \| "disabled", version }` — only declared attributes |
| `remove`, reason `unentitled` (lost every role)              | `userId`, `last: { username, displayName?, email? }` — what the plugin last received                                            |
| `remove`, reason `deleted` (removed from the directory)      | `userId`, `last` as above — history stays readable                                                                              |
| `remove`, reason `erased` (an administrator erased the user) | `userId` alone                                                                                                                  |

The panel materializes each plugin's audience in `state.db` (`plugin_audience`): one row per plugin and user who was ever a member, written only when the change differs, each write stamped with the next value of one store-wide sequence (`seq`, by triggers) — the feed's cursor. It recomputes the audiences after every change of users, the directory or entitlements made through the panel (the Gatekeeper proxy included), on a plugin's install, update and approval, at start and every minute (Gatekeeper's own CLI edits); while Gatekeeper cannot be read, the stored audience stays as it is (erasures still go in). A disabled user stays a member with `status: "disabled"`.

**The audience is the plugin's erasure ledger.** Its rows record everyone the plugin's agent halves were ever sent, so they outlive the feed: when the plugin is uninstalled while an agent keeps its data ([retained data](app-host.md)), or stops declaring identity, its rows stay — recomputed for **erasures alone** (erasing a user rewrites their row, with a new `seq`, in every plugin that has one) — and its erasures stay pending, marked as such on the directory (`pendingErasuresInactive`). A plugin that comes back — reinstalled with its half reusing the data an agent kept, or declaring identity again — replays them: a new hosting's half is always sent a full replay. The rows go only when no data of the plugin is left anywhere: an uninstall with purge, or its retained data purged or forgotten once it is uninstalled. When data is retained, the relay records with it how far the half's projection had applied the feed (`retained_agent_data.identity_cursor`, migration `0014`): the erasures after that are pending on that agent.

### The identity feed

The agent half cannot reach the panel, so the panel pushes: two calls through the internal tunnel, Lamaste's own (`callAgentHalf`: caller `lamaste`, the body hash bound, the answer authenticated by its responder signature over the body). The forwarder reserves `/admin/identity*`, so no administrator or agent reaches them.

```
POST /admin/identity/notify   { protocol: 1, directoryId, seq }
  → 200 { protocol: 1, directoryId, cursor }      what the half holds (directoryId null before its first batch)
POST /admin/identity/changes  { protocol: 1, directoryId, from, to, reset, reconcile, pass, final, changes: { v: 1, iv, ct } }
  → 200 { protocol: 1, directoryId, cursor, mismatches? }
  → 409 { error: "cursor_mismatch", protocol: 1, directoryId, cursor }
```

- **The changes travel sealed.** The internal tunnel's ends are loopback ports — the chisel server's on the relay, the agent's on the agent — and whatever holds one sees what crosses it. A batch's envelope (directory, cursors, flags, pass) is no one's personal data; its `changes` array is encrypted with AES-256-GCM under `HKDF-SHA256(installation secret, salt "lamaste/identity-changes/v1", info route)` — a key of its own, never the settings secrets' — with 12 random IV bytes and, as additional data, the route, the caller assertion's nonce and the whole envelope (`JSON.stringify([plugin, nonce, directoryId, from, to, reset, reconcile, pass, final])`): sealed changes open only in the one request that carries them, under that envelope (`sealIdentityChanges`, `openIdentityChanges` in `@lamalibre/lamaste`; the verified request's `openIdentityChanges` in an agent half). Notifications and answers carry no member and stay as they are. The 1 MiB limit is the sealed request's.
- `seq` in a notification is the plugin's head; `directoryId` the relay directory's id (a UUID v4 made with `state.db`).
- A batch carries the changes of `(from, to]` in strictly increasing `seq`, each one of the [changes above](#entitlements-and-the-audience) with its `seq` — at most 500 changes and 1 MiB. The half applies it and moves its cursor to `to` in one transaction; one that does not continue from its cursor (another `from`, or another directory without `reset`) is answered `409` with what it holds, and the panel continues from there (or replays) — up to three times per sync.
- **A replay from 0 is the snapshot.** The panel replays when the half follows another directory or none, its cursor is ahead of the head (a restored relay), it never completed a replay since the plugin was installed or hosted, a replay was cut short — and once a day as a **reconcile**. Every batch of a replay carries the same `pass`; the first has `reset: true` (the half adopts `directoryId` and restarts its cursor), the last `final: true`, when the half marks every row the pass did not mention as removed. Batches with `reconcile: true` — every batch of the daily reconcile, and every batch after the first of any replay — have the half count every change that differs from its row (and, at the final batch, every row the pass did not mention) and answer `mismatches`. For the daily reconcile a non-zero count on a healthy system is a feed bug: it is recorded on the plugin's sync state and audited as `identity.reconcile.mismatches`.
- A half that speaks another protocol answers `400 { error, protocol: 1 }`; one built before 4.5 has no such route. Either way the sync fails and says so.

**When it runs.** After a recompute that changed the plugin's rows, when its agent half comes up (a health transition), after a hosting, an update or its revert succeeded, on approval, at the panel's start, every minute for a plugin that is behind or whose last sync failed, daily (the reconcile), and on demand (`POST /api/plugins/:name/identity/sync`). One sync per plugin at a time; requests made while one runs share the next. A sync runs only for a plugin that declares `identity`, whose installed version is approved, that is hosted, and whose hosting is active and not down; otherwise it records why (`lastError`). When a hosting is removed, what the panel knew of its half goes with it: the half of a later hosting must answer again and receives a replay. The audience itself stays — it is the plugin's, not the hosting's.

**Readiness.** Users reach the plugin only once its agent half has **applied every change up to the head after a complete replay** — a sync that ended with the half's cursor at the head, a full replay done since the half was hosted — **since the installed version was installed** (`readyVersion`). Answering the notification is not enough: a half still behind would serve stale roles, names and erasures. So a half built on core 4.4 never receives a user caller — it would refuse one as malformed — and an update that brings a new half waits until that half has caught up. `readiness.reason` says why a plugin is not ready:

| `reason`        | Meaning                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| `not_installed` | No installed plugin holds the route                                                           |
| `no_identity`   | The installed version declares no `identity`                                                  |
| `not_approved`  | The installed version is not approved                                                         |
| `not_hosted`    | The plugin is not hosted, or its hosting is not active                                        |
| `not_answered`  | Its agent half has not applied the feed up to the head (protocol 1) for the installed version |

### The plugin's domain

On a relay with several domains a plugin belongs to one ([`PUT /api/plugins/:name/domain`](domains.md#put-apipluginsnamedomain); the primary until moved). Its audience is the entitled users who are members of that domain — a member leaving becomes `remove/unentitled`, so agent halves see no new reason; a tunnel bound as its user surface and its web surface must be on that domain; its OIDC clients' `{domain}` and sign-in policy are that domain's. Moving it is refused while a surface is served (409 `surface_bound`).

### The user surface

A plugin's users reach it at `/api/<route>/app` and everything under it, on the host of an app tunnel **bound** as the plugin's user surface ([Tunnels API](tunnels.md#user-surface-binding)) — a tunnel its hosting agent carries — or on the site the plugin owns for its [web surface](#web-surface), which serves the same paths the same way (where the steps below say tunnel, read site; a site's grant is a `site` grant). The bound host serves those paths only while the plugin's installed, approved version declares `identity` and the tunnel's agent hosts the plugin; before that, its requests go down the tunnel as every other path does — which is how a plugin moves its users' API to the relay with a plain update. Each request:

1. **nginx** asks Gatekeeper (`auth_request` to `/authz/user-surface/<fqdn>`, the tunnel named in the path).
2. **Gatekeeper** checks the tunnel (enabled, not public, the route bound to it), that the raw request target lies on that route's user surface — no `.` or `..` segment, no backslash, no percent-encoded `.`, `/`, `\` or `%`, no escape that does not decode, so the path it approves is the path every server after it resolves, even one that decodes twice — that the tunnel's agent hosts the plugin (it carries the plugin's internal tunnel), the Authelia session (one `authelia_session` cookie, never two), and on a `restricted` tunnel the user's grant for the tunnel. It answers with a **relay assertion for the panel**: Ed25519 with the relay signing key, audience `@panel`, port 3100, caller `{ type: "user", username }` — the username alone — bound to the method and the raw request target, single use, never cached. Without a session it answers a JSON `401 { error: "unauthenticated" }` (never a login redirect: the caller is an application's request); anything else refused is a bare `403`.
3. **nginx** passes the request to the panel on `127.0.0.1:3100` with the assertion and the request target exactly as the browser sent it, and nothing else of the browser's credentials: `Cookie`, `Authorization`, `Remote-*`, `X-SSL-Client-*` and `X-Forwarded-Host` are cleared ([nginx Configuration](../03-architecture/nginx-configuration.md#user-surface-locations)).
4. **The panel** serves `/api/:route/app` and `/api/:route/app/*` in a context of its own — no mTLS, no 2FA session, no role guard; the assertion is the only thing it trusts — and answers, in order:

| Check                                                                                                                                                                                       | Refusal                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The request was not started by another site: `Sec-Fetch-Site` absent, `same-origin` or `none` — whatever the method                                                                         | `403 { error: "cross-site request refused" }`                                                                                                        |
| The request does not load code: `Sec-Fetch-Dest` is not `script`, `style`, a worker or a worklet (a web surface's policy allows code from its own host — `'self'` takes in the API's paths) | `403 { error: "not a script or style source" }`                                                                                                      |
| The assertion verifies (audience `@panel`, port 3100, method, raw target, 60 s + 5 s skew, nonce once) for the URL's route                                                                  | `401 { error: "unauthenticated" }` — JSON, no redirect                                                                                               |
| The route is bound to an enabled tunnel its plugin's hosting agent carries, and the plugin is enabled, hosted and not down                                                                  | `404` (no user surface here) or `503` (not available right now — nothing is forwarded while the hosting is `down`)                                   |
| A method other than `GET`, `HEAD` and `OPTIONS` carries `Origin: https://<bound host>` (CSRF)                                                                                               | `403 { error: "cross-origin request refused" }`                                                                                                      |
| The directory's user for the attested username, for this plugin                                                                                                                             | `404` (no identity), `503` (not [ready](#the-identity-feed)), `403` (disabled, removed, not entitled, an earlier holder's principal not yet cleared) |

5. Then the request goes to the agent half's `/app/<rest>?query` with the [user caller](#the-user-caller), through the admin forwarder's pipeline: the same stripped headers (method and URL overrides among them), the internal tunnel's body limit (`413`), the plugin's approved [request hooks](lifecycle-hooks.md#request) on its `/app` routes, the responder check (`502` without it), streaming, timeouts, and no `Set-Cookie`, `Service-Worker-Allowed`, `Clear-Site-Data`, `X-Lamalibre-*` or `X-Accel-*` back.

**Every answer** of the user surface — the agent half's, a hook's, the panel's own refusals and errors, the rate limit's — carries `Cross-Origin-Resource-Policy: same-origin`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'` (an application's own `Content-Security-Policy` is kept as a further policy, which can only restrict more; its resource policy and `nosniff` are replaced), and never `Access-Control-*`: the panel's CORS is off for these routes and the application's are removed, so no other origin reads a user's answers and no answer runs as a page of the bound host. The relay's own errors are **fixed texts** per status (`userSurfaceErrorText`: `"The application is unavailable"` for a `502`, `"The application did not answer in time"` for a `504`, `"Request body too large"` for a `413`, …) — never an internal message, a socket error or which side failed; those go to the log line.

**Open responses.** While a response is being sent — an event stream, a slow download — the panel keeps it with its user's `userId` and roles, and every 5 seconds resolves each user again through the directory: a response whose user is disabled, removed or no longer entitled (`access_revoked`), now holds other roles (`roles_changed`), or whose route the host no longer serves (`surface_withdrawn` — unbound, the tunnel disabled or moved, the plugin unhosted) is ended at once, the browser's connection and the request to the agent half alike. No response lives longer than **one hour** (`USER_SURFACE_MAX_RESPONSE_SECONDS`); nginx's timeouts on the user-surface locations are the same hour. An application that streams longer reconnects; its next request is checked anew. The request's log line says why the relay ended it (`ended by the relay: <reason>`).

The user surface has its own rate limit: 1200 requests a minute per client address and route (the panel's root limit is for its administrators). The panel logs no URL and no client address for these requests: Fastify's own request lines are off, its one line per request has the route pattern (`/api/:route/app/*`), the status and the duration; the forwarder's line names the user as `user:<userId>` with the path asked of the agent half without its query — never a username, a query string or a body. nginx's access log still records each request's client address and URL ([Monitoring](../05-operations/monitoring.md#logs-and-personal-data)). The origin a request must come from is the route's host as `tunnels.json` or `sites.json` names it, never the request's `Host`.

On the panel's router `/api/<route>/app*` are static routes that win over the admin forwarder's wildcard, so **the admin forwarder no longer reaches an agent half's `/admin/app` or anything under it**; an agent half keeps none of its admin routes there.

### The user caller

A forwarded user request carries the caller assertion (`X-Lamalibre-Caller`, still version 1, HMAC with the installation secret, no body hash — it streams) with

```json
{ "type": "user", "userId": "6f1c…-4…", "username": "alice", "roles": ["viewer"] }
```

— the directory's `userId` (a lower-case UUID v4: key everything on it, a username can come back as another person), the username to show, and the user's roles in this plugin (1–32 of its declared role ids, from the audience). Paths are a **boundary between callers**: a `user` caller is valid only for `/app`, `/app/…` and `/app?…` read literally with no unsafe segment (an encoded `%` — `%25` — is one), and every other caller — an administrator, an agent, Lamaste — never for a path a router could take for `/app` (`/App`, `/%61pp`, `/app.json`, `/apps`). Whoever the caller, the path must be in **origin form**: exactly one leading `/` — never `//` or `/\`, no scheme, no host (`http://x/app/me`, `//app/x`). Signing refuses each mistake and the verifier answers `wrong_request`, so an administrator's assertion cannot act on a user's routes, a user's never reaches `/admin`, and no assertion names a path a router could read as another host's. A verifier built before 4.5 refuses a user caller as `malformed`; the panel never sends one before the agent half is [ready](#the-identity-feed).

An agent half verifies `/app` requests with its `createCallerAssertionVerifier`, checks `verified.payload.caller.type === "user"` and the roles it needs, and signs **every** answer to a verified request — a `404` and a `405` too — with `responderHeaderFor(verified, status)`; the relay passes on nothing that is not signed. An administrator certificate holds every role in the plugin's admin pages, which ignore roles; those pages stay on `/admin`.

### In the agent half

`@lamalibre/lamaste/agent` keeps the projection and answers the feed:

```js
import { DatabaseSync } from 'node:sqlite';
import {
  createCallerAssertionVerifier,
  createIdentityHandlers,
  createIdentityProjection,
} from '@lamalibre/lamaste/agent';

const db = new DatabaseSync(`${dataDir}/app.db`);
const projection = createIdentityProjection({
  db,
  // Inside the batch's transaction, synchronous: anonymise what the plugin keeps.
  onErase: (userId, tx) =>
    tx.prepare('UPDATE notes SET author = NULL WHERE author_id = ?').run(userId),
});
const identity = createIdentityHandlers({ verifier, projection, logger });

// POST /admin/identity/notify and /admin/identity/changes — the body exactly as received
const answer = await identity.handle({ method, url, headers, body: rawBody });
// send answer.status, answer.headers and answer.bodyText, byte for byte
```

- **`createIdentityProjection({ db, onUpsert?, onRemove?, onErase? })`** keeps two tables in the half's own database, created when missing — `lamaste_users` (one row per user the feed ever named: the declared attributes it last carried, roles, `active` / `disabled` / `removed` with reason and time, `erased_at`, version) and `lamaste_identity_cursor` (the directory and the cursor) — and never touches the database's `user_version`, which stays the plugin's. A batch and its cursor are written in one `BEGIN IMMEDIATE` transaction. Removal keeps history readable: a deleted or unentitled user keeps the row with the last known attributes, no roles, `removed`; an **erased** user is scrubbed to the bare `userId`, and `onErase` anonymises the plugin's own data in the same transaction — the cursor passing the erasure is the acknowledgement the panel waits for. **An erasure is sticky**: once a row is erased, no later `upsert` or `remove` (`deleted`, `unentitled` — what a relay restored from an older backup would send) writes a username, name or address into it again; the row stays the bare id, no hook but `onErase` runs for it (and `onErase` only when the change is the erasure itself, or the row had to be scrubbed again), and in a reconcile such a change counts as a mismatch. Hooks run inside the transaction and must be synchronous; one that throws rolls the batch back and the panel sends it again. Replays repeat erasures (the daily reconcile replays every one), so `onErase` must be idempotent — which is also how an erasure reaches data restored from an older backup. It offers `state()`, `applyBatch(request)`, `getUser(userId)` and `listUsers({ includeRemoved })`.
- **`createIdentityHandlers({ verifier, projection, logger? })`** answers `POST /admin/identity/notify` and `POST /admin/identity/changes`: `404` for another path, `405` for another method, `400` for a body already parsed, `413` above 1 MiB — unsigned, before verification; `401` for an assertion that does not verify or does not sign the body; then, signed: `403` for any caller but Lamaste, `400` for a body that is not the contract (or of another protocol, with `protocol: 1`) or whose sealed changes do not open for this request (`The identity changes could not be opened`), the projection's state, a batch applied, `409 cursor_mismatch`, `500` when the projection failed (rolled back). It opens a batch's sealed changes with the verified request's `openIdentityChanges` before parsing the batch; the projection sees the plain batch. A plugin with its own person model may pass any `projection` with `state()` and `applyBatch()` that throws `IdentityCursorConflictError`.

Neither logs a member's attributes: log lines carry the directory, the cursor and counts.

### Erasure

Deleting a user tombstones them; **erasing** scrubs the tombstone ([Users API](users.md#erasing-a-removed-user)). Every plugin that ever had the user as a member has their row rewritten to `remove` with reason `erased` and no attributes — inactive plugins included ([the ledger](#entitlements-and-the-audience)); a plugin that takes the feed is sent it, and its agent half scrubs its row and runs `onErase` in the same transaction — for good: an erasure is sticky in the projection. The panel shows the erasures a plugin has not acknowledged as `pendingErasures` on the plugin's identity view and, per user, on the directory: those stamped after its hosting's half's cursor (all of them while no half has answered), and those stamped after the position recorded with the data an agent retains of it. Delivery takes seconds while the hosting agent is online and happens when it reconnects otherwise — or, for an inactive plugin, when it comes back.

### Endpoints

All admin only. `404` when the plugin is not installed; `400 { code: "no_identity" }` from the audience, entitlement and sync routes for a plugin that declares no identity.

#### `GET /api/plugins/:name/identity`

```json
{
  "identity": {
    "declared": { "roles": [{ "id": "viewer", "label": "Viewer" }], "attributes": ["displayName"] },
    "readiness": {
      "ready": true,
      "declared": true,
      "approved": true,
      "hostingActive": true,
      "version": "1.1.0",
      "readyVersion": "1.1.0",
      "reason": null
    },
    "approval": { "approved": true, "state": "approved" },
    "sync": {
      "directoryId": "3b0e…",
      "halfDirectoryId": "3b0e…",
      "cursor": 42,
      "head": 42,
      "behind": 0,
      "readyVersion": "1.1.0",
      "lastSyncAt": "2026-10-22T09:14:03.120Z",
      "lastReconcileAt": "2026-10-22T03:00:11.002Z",
      "lastMismatches": 0,
      "lastError": null
    },
    "audience": { "active": 12, "disabled": 1, "removed": 3, "erased": 1 },
    "pendingErasures": []
  }
}
```

For a plugin without identity: `declared`, `sync` and `audience` are `null`, `readiness.reason` `no_identity`, and `pendingErasures` the erasures it still owes from when it declared identity (empty for a plugin that never did). `sync.cursor` and `halfDirectoryId` are what the half last answered; `behind` is how many rows it has not applied; `lastError` why the last sync did not finish or was not tried.

#### `GET /api/plugins/:name/audience`

`{ head, audience: [{ userId, seq, version, updatedAt, change }] }` in `seq` order — members and tombstones, each `change` as the feed delivers it (without `seq`).

#### `GET /api/plugins/:name/entitlements`

`{ entitlements: [{ grantId, principalType, principalId, userId, roles, unknownRoles, createdAt }], roleless }` — the role grants (a user principal with its directory `userId`, `null` for a group; `unknownRoles` those the installed version no longer declares), and how many grants on the plugin carry no roles.

#### `PUT /api/plugins/:name/entitlements`

```json
{ "principalType": "user", "principalId": "alice", "roles": ["viewer"] }
```

Gives the principal exactly these roles (`principalType` `user` with a username, or `group` with a Lamaste group name). `{ ok, entitlement, changed, warnings? }`. `400` `invalid_roles` or `unknown_roles` (with `unknown`); `404` `user_not_found` (the user must be in the directory and not removed) or `group_not_found`; `503` `gatekeeper_unavailable` (also when an earlier holder's principal under the username cannot be cleared first); Gatekeeper's own refusals with its status, `gatekeeper_refused`. Audited as `plugin.entitlement.set` (a user by `userId`, never by name). 30 a minute.

#### `DELETE /api/plugins/:name/entitlements?principalType=<user|group>&principalId=<id>`

Revokes every role grant of the principal on the plugin (grants without roles stay). `{ ok, revoked, warnings? }`; `404 entitlement_not_found`, `502 gatekeeper_refused` when Gatekeeper revoked none. Audited as `plugin.entitlement.removed`. 30 a minute.

#### `POST /api/plugins/:name/identity/sync`

`{ "reconcile"?: true }` — sync now; `reconcile` replays everything and counts mismatches. Answers when the sync ended: `{ ok, result, sync }` — `result.status` is `synced`, `up-to-date`, `skipped` (with `reason`) or `failed` (with `error`), with `cursor`, `replay` and, for a reconcile, `mismatches`; `sync` is the state above. 10 a minute.

### In the panel and the CLI

On the Plugins page, a plugin that declares identity gets a **People** section on its card: the declared roles and attributes with the approval state and readiness (with its reason), the entitlements by user or group with a checkbox per role (add, change, remove), the audience — members with their roles and status, and tombstones — the sync state (directory, head, the half's cursor, last sync and reconcile, mismatches, last error) with **Sync now** and **Reconcile**, and pending erasures. **Lifecycle hooks** shows the identity block in the approval preview and an update's identity diff, with `identity.changed` among the reasons it waits. The desktop app shows the same through `AdminClient` (`getPluginIdentity`, `getPluginAudience`, `getPluginEntitlements`, `setPluginEntitlement`, `removePluginEntitlement`, `syncPluginIdentity`; Tauri commands `admin_get_plugin_identity`, `admin_get_plugin_audience`, `admin_get_plugin_entitlements`, `admin_set_plugin_entitlement`, `admin_remove_plugin_entitlement`, `admin_sync_plugin_identity`).

```
lamaste-server plugins identity <name>             # roles, attributes, approval, readiness, sync state, pending erasures
lamaste-server plugins audience <name>             # members and tombstones
lamaste-server plugins entitlements <name>         # role grants
lamaste-server plugins entitlements <name> --user <u>|--group <g> --roles a,b
                                                   # exactly these roles
lamaste-server plugins entitlements <name> --revoke --user <u>|--group <g>
lamaste-server plugins identity-sync <name> [--reconcile]
```

`plugins hooks` and `plugins update` print the identity block, an update's identity diff and the `identity.changed` reason. Binding the user surface: [Tunnels API](tunnels.md#user-surface-binding).

## Web surface

A plugin that declares `userSurface.web` ships its users' **shell** — a static web application — in its server package, and the relay serves it on a **site the plugin owns**, beside its [user surface](#the-user-surface)'s `/api/<route>/app/*`: one host, one Authelia session. The shell calls `/api/<route>/app/…` on its own origin, and gets the user's answers through the same path a bound tunnel's host gives them. A plugin needs no tunnel and no web server of its own for its users, and the relay never serves a file of it that was not approved.

### The web tree

The files under `root` in the server package are the plugin's **web tree**. Every file must be a regular file — a link anywhere fails the read — with a path of segments of letters, digits, `.`, `_` and `-`, none starting with `.`, at most 16 levels and 256 characters, and an extension of `.html .css .js .mjs .json .webmanifest .txt .png .jpg .jpeg .gif .svg .ico .webp .avif .woff .woff2 .ttf .otf` (no `.wasm`: the shell's policy does not let it compile), each served under its own content type (core `WEB_TREE_CONTENT_TYPES`, named in the vhost rather than taken from the host's `mime.types`); at most 2,000 files, 8 MB a file and 32 MB in all, with an `index.html` at the top. The tree's digest is SHA-256 over the JSON `{"v":1,"files":[[path,size,sha256],…]}`, the files sorted by path (core `webTreeManifest`).

The digest enters the [approval](#approval) (`web: { treeSha256 }`, only for a plugin that declares a web surface — every other digest is unchanged). It is read from the installed package at install (a tree that breaks a rule is refused, `400`, `code: "invalid_web_tree"`) and from the registry tarball when an update is staged, so the update preview shows the new tree before anything is installed and the installed package must hold the very tree that was reviewed. A changed tree is `digest.unapproved`, and **auto-approve never covers it** (`web.changed`, [above](#approval)). The update preview lists what changes by path — `changes: { added, removed, changed }`, each `{ count, paths }` (at most 200 paths, the count exact), and `review`: the added or changed paths an administrator should look at closely, a page other than `index.html`, an SVG or a manifest — and the panel shows them under the approval; `changes` is `null` when the installed tree cannot be read. `GET /api/plugins/:name/hooks` shows it as `web: { declared, approved, treeSha256, surface }`.

### Serving the tree

The relay keeps each plugin's trees in `/var/www/lamaste/apps/<route>/`: every tree under its digest, and two links — `current`, what the site serves, and `previous`, the tree before it. While the plugin **owns a site** and its installed version is **approved** — when the site is created or moved, in every update (its last step, `serve the new web tree`, once the new version is installed and every stage passed: a tree that cannot be served reverts the update), after a revert, an approval or a hosting, and at the panel's start — the approved tree is copied out of the installed package (regular files only, read without following links), the copy's own digest checked against the approved one, and `current` switched to it with a rename; `previous` keeps the tree it replaces and every older tree goes. **Going back to the tree `previous` names** — a reverted update, a rollback release — abandons the outgoing tree: `previous` goes and the tree is removed, so none of a version that was backed out of is served any more. The plugin is read again inside the store's lock, so two refreshes never switch to an older tree. A plugin without a site has no store, and a deleted store stays deleted. Audit: `plugin.web-tree.switched`.

### The site

A plugin owns at most one site, in `sites.json` with `owner: { plugin: <route>, package: <server package> }` and its `accessMode`. The sites API lists it but does not manage it — files, settings, deletion are refused (`409`, `code: "plugin_owned_site"`), and so is `lamaste-agent deploy`. Its vhost ([nginx Configuration](../03-architecture/nginx-configuration.md#web-surface-vhosts)):

- serves the **shell** — every path but the API — from `current`, `GET` and `HEAD` only (`405` otherwise), asking Gatekeeper first (`/authz/user-surface-shell/<fqdn>`): an Authelia session, membership of the plugin's audience (an entitlement with roles, to the user or a group of theirs) and, on a `restricted` site, a Gatekeeper grant on the site (`resourceType: "site"`, `resourceId: <site id>`). A page without a session goes to the login; a user without access gets the access-request page. A **script, style sheet, font or image** `current` lacks is looked for in `previous` (a page still running the old shell loads its lazy files after an update), else `404`; any other path `current` lacks — a page, an SVG, a manifest — gets the current `index.html`, never the previous tree's. **No service worker** is ever registered: a request for a worker's script (`Service-Worker: script`) gets `404`, which also unregisters one already installed at its next update check — a worker would outlive the tree that installed it, a revert, the site's deletion and the hostname's next owner. Every shell answer carries `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` (no other host learns from a subresource whether the user may use the plugin) and `Cache-Control: no-cache` (every file revalidated: a `304` while the tree is unchanged, the new file after an update). A shell therefore loads everything from its own host — no font, script or style from a CDN — and runs no inline script;
- serves the **API** at `/api/<route>/app*` exactly as a [bound tunnel's host](#the-user-surface) does;
- answers **`503`** to everything while the surface is not served — no plugin is installed under the route, the installed version does not declare identity or a web surface, the site was created for another package (`not_owner`), the version is not approved, not hosted, or its tree is not current yet. Once its plugin is **uninstalled** the `503` also carries `Clear-Site-Data: "storage"`: whatever takes the hostname next does not inherit the plugin's browser storage, caches or workers. Never while the plugin is only unhosted or waiting for approval — its users' data stays.

The panel's user-surface context takes a plugin-owned site as the route's host (its `Origin`, its open responses), and Gatekeeper reads `sites.json` beside `tunnels.json`; a route two hosts would serve is served by neither. A plugin that owns a site cannot have its user surface bound to a tunnel, and a tunnel cannot be created on, or enabled for, a hostname a site serves. Uninstalling the plugin keeps the site, answering `503`, until it is deleted — `DELETE /api/plugins/<name>/web-surface` works without the plugin, and the Sites page offers it. A site records the **package** it was created for (`owner: { plugin, package }`): another package installed later under the same route is not served from it (`not_owner`) — it inherits neither the hostname nor the grants nor the old tree; delete the site, then create one for it.

### Moving from a bound tunnel

A plugin whose users reach it through a tunnel bound as its user surface — the tunnel's backend serving the shell — moves to its web surface with one call: the site is created on the tunnel's hostname (its certificate kept), the tunnel is disabled and unbound in the same state change, and **one nginx reload** hands the hostname from the tunnel's vhost to the site's; the tunnel's port grant is withdrawn only after that, for new sessions alone — chisel is not restarted, which would drop the plugin's internal tunnel (its API answering `502` until the agent reconnects) and fail what nginx's old workers still send to the tunnel; the agent drops the binding at its next sync, restarting its tunnel client as on any tunnel change. There is no moment without an answer. The tunnel stays in `tunnels.json`, disabled and unbound, and its vhost stays installed, unlinked, for a rollback by hand: delete the web surface, enable the tunnel (its vhost is linked again), bind it again. The site takes the tunnel's access mode — a tunnel without a known one is `restricted`, as everywhere else — and a restricted tunnel's grants are copied to the site. Every step from the copy of the grants to the handover is undone in reverse order on a failure: no grant, site entry or tunnel change outlives a move that did not happen; and a move the panel stopped between its state writes and the handover is finished at the next start (the tunnel's vhost unlinked, the site's linked). The tunnel must be enabled, carried by the plugin's hosting agent and bound to this plugin alone, and the plugin approved; when nginx refuses the new configuration everything is put back. Audit: `plugin.web-surface.moved`.

### Endpoints

All admin only.

#### `GET /api/plugins/:name/web-surface`

```json
{
  "webSurface": {
    "declared": { "defaultSubdomain": "piyasa", "accessMode": "authenticated", "root": "web" },
    "site": {
      "id": "…",
      "name": "piyasa",
      "fqdn": "piyasa.example.com",
      "accessMode": "authenticated"
    },
    "served": true,
    "reason": null,
    "tree": { "approved": "5b2a…", "current": "5b2a…", "previous": "85dc…" },
    "boundTunnel": null,
    "offer": null
  }
}
```

`reason` while not served: `not_installed`, `no_identity`, `no_web_surface`, `not_owner`, `not_approved`, `not_hosted`, `tree_not_current`. `site.ownerPackage` is the package the site was created for. `boundTunnel` names a tunnel bound as the plugin's user surface (`{ id, fqdn, enabled, routes }`) — enabled or not, creating a site is refused while it is bound. The status of a site whose plugin is no longer installed stays readable (`reason: "not_installed"`); `404` only when neither a plugin nor a site holds the route. `offer` — while the plugin owns no site, declares a web surface and has no tunnel bound as its user surface (then moving is the way) — is `{ subdomain, accessMode, available }`: what the panel offers to create, and whether the name is free.

#### `POST /api/plugins/:name/web-surface`

`{ subdomain?, accessMode? }` (defaults: the declared ones). Issues the certificate, serves the approved tree if there is one, writes the site and its vhost; `201 { webSurface }`. Refused: `no_web_surface` / `no_identity` (`400`), `exists`, `bound_to_tunnel` (move it instead), `hostname_taken` (a tunnel or a site holds the name, or it is reserved), `web_tree` (`409`). Audit: `plugin.web-surface.created`.

#### `POST /api/plugins/:name/web-surface/move`

`{ tunnelId }` — see [Moving from a bound tunnel](#moving-from-a-bound-tunnel). `{ webSurface }`. Refused: `exists`, `not_bound`, `shared_tunnel` (other routes are bound there), `tunnel_disabled`, `not_hosted`, `not_approved`, `hostname_taken`, `web_tree` (`409`), `not_found` (`404`), `gatekeeper` (`503`, a restricted tunnel's grants could not be read or copied).

#### `DELETE /api/plugins/:name/web-surface`

Removes the vhost, the site, the trees and the grants on the site; the plugin stays installed — or is already gone (`:name` derives the route). `{ ok: true }`, with `grantsNotRevoked` listing the grants Gatekeeper did not revoke (they name a site that no longer exists), or `grantsUnlisted: true` when it could not list them; `404` when nothing owns a site under the route. Audit: `plugin.web-surface.deleted` (with `grantsNotRevoked` or `grantsUnlisted`).

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
lamaste-server plugins approve-hooks <name> --digest <sha> [--version <v>]
                                                          # approve it; a pending update by its version too
lamaste-server plugins settings <name>                    # its settings (secrets only as set), the hosting
lamaste-server plugins configure <name> [--set key=value]... [--clear key]... [--secrets-stdin]
lamaste-server plugins identity <name>                    # its users: roles, readiness, the feed's state
lamaste-server plugins audience <name>                    # members and tombstones
lamaste-server plugins entitlements <name> [--user <u>|--group <g> --roles a,b] [--revoke --user <u>|--group <g>]
lamaste-server plugins identity-sync <name> [--reconcile] # send its audience to the agent half now
lamaste-server tunnels bind-user-surface <tunnel> <plugin>   # serve the plugin's user surface on the tunnel's host
lamaste-server tunnels unbind-user-surface <tunnel> <plugin>
lamaste-server push-install status|on|off                 # the switch, policies, every agent's window
lamaste-server push-install open <agent> [--minutes <n>] [--policy <id>]
lamaste-server push-install close <agent>
lamaste-server push-install default-policy <id>
```

`lamaste-server plugins list` shows where each hosted plugin runs, its health and the agent half version. `host` and `unhost` follow the operation step by step and exit non-zero unless it succeeded. A refusal is explained: `agent_not_eligible` lists the reasons (and points at `eligibility`), `push_install_refused` says which gates a push passes — `lamaste-server` calls the panel from `127.0.0.1`, so the agent's policy must allow that address. `--purge` names the data directory it deletes before it starts. `retained-data` lists every agent's records — marking those of uninstalled plugins — or one plugin's, with the data directory and account of each; `purge-data` says which directory and account it deletes, follows the operation and exits non-zero unless it succeeded; `forget-data` says that nothing on the agent changed and how to remove the data there. `hooks` prints the approval digest, the relay hook set and the agent half (package and version, integrity, entry and memory limit, the account and unit it runs as, its data directory, its system packages), and a pending update's — with why it waits (`approvalRequired`; a secret turned plain in red) and the `approve-hooks` command that approves it, naming its version (`--digest <sha256> --version <v>`, or `--version <v>` alone when it has no digest) — and the identity block, an update's identity diff and the `identity.changed` reason; `update` prints the same for an update that waits. The identity commands are described under [Users and identity](#in-the-panel-and-the-cli). `settings` and `configure` — interactive in a terminal, a secret only from a masked prompt or stdin, never an argument — are described under [Settings](#from-the-cli). `push-install status` lists the switch, the default policy, each policy's actions, packages and addresses, and each enrolled machine agent's window (`open until …` with its policy, or `closed`); `open` checks the minutes against the bounds the panel reports (default 30).

## State

| Path                                                                            | Contents                                                                                                 |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/etc/lamalibre/lamaste/plugin-hostings.json`                                   | Hosting records with their secrets (0600, atomic, one per plugin), owner and agent half version          |
| `/etc/lamalibre/lamaste/tunnels.json`                                           | The internal tunnel, like every tunnel                                                                   |
| `state.db` `plugins.route`, `plugins.agent_half_pin`                            | The plugin's unique route; the pinned agent half `{ package, version, integrity }`                       |
| `state.db` `agents.host_facts`, `host_facts_at`                                 | What each agent reported about its host                                                                  |
| `state.db` `agents.push_install_enabled_until`, `push_install_policy`           | Each agent's push-install window and policy                                                              |
| `state.db` `agent_jobs.payload`, `agent_jobs.signature`                         | App job parameters and the relay's signature over them                                                   |
| `state.db` `retained_agent_data`                                                | Data agents keep of removed agent halves                                                                 |
| `state.db` `plugins.settings`                                                   | The installed manifest's settings block — the schema the panel checks a change against                   |
| `state.db` `plugin_settings`                                                    | The cache of each plugin's settings: non-secret values, `{ key: setAt }` for secrets, status, provenance |
| `state.db` `agent_presence`                                                     | When each agent last contacted the relay (written at most once a minute per agent)                       |
| `state.db` `plugins.identity`                                                   | The installed version's identity block, normalized                                                       |
| `state.db` `plugin_audience`                                                    | Each plugin's audience as last delivered — one change per plugin and user, stamped with `seq`            |
| `state.db` `plugin_identity_sync`                                               | What the panel knows of each agent half's feed: directory, cursor, ready version, last sync and error    |
| `state.db` `plugins.user_surface`, `plugins.web_tree_sha256`                    | The installed version's `userSurface` block; its web tree's digest                                       |
| `/etc/lamalibre/lamaste/sites.json` (`owner`, `accessMode`)                     | The site a plugin owns                                                                                   |
| `/var/www/lamaste/apps/<route>/`                                                | The plugin's web trees (`<sha256>/`), `current` and `previous` (lamaste, group www-data; 0750/0640)      |
| `<agent half's database>` `lamaste_users`, `lamaste_identity_cursor` (agent)    | The agent half's projection of its audience (`createIdentityProjection`)                                 |
| `/etc/lamalibre/lamaste/push-install-config.json`, `push-install-sessions.json` | The switch and policies; the push log (last 500)                                                         |
| `<agent>/agents/<label>/app-plugins/<route>.json`                               | The agent's copy of the port and secret (0600)                                                           |
| `/etc/lamalibre/apps/<route>/plugin-config.json` (agent)                        | The service's copy, for an agent half Lamaste installed (0600, its account)                              |
| `<data directory>/settings.json`, `secrets.json` (agent)                        | The plugin's settings and secrets, kept by the agent half (0600, its account)                            |

Installation secrets leave the relay only through `GET /api/agents/me/plugin-config/:route`, over TLS, to the hosting agent's certificate. Settings secrets never rest on the relay: they cross it in the memory of one request, and the tunnel sealed, to the agent half. Files on the agent: [App Host](app-host.md#what-it-creates).
