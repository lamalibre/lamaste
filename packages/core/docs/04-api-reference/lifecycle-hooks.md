# Lifecycle Hooks

An [agent-hosted plugin](agent-hosted-plugins.md) can plug code into the steps Lamaste takes for it — hosting it, removing it, forwarding its admin API, noticing its tunnel go down. Lamaste owns every step; a plugin's hooks run around them. **Relay hooks** run on the relay, in a sandbox, only after an administrator approves them; **agent hooks** run in the plugin's agent half on its own agent. The design is `plugin-development/design/agent-hosted-app-plugins.md` (Slice 2).

## In Plain English

Each of Lamaste's steps is wrapped like an onion:

```
relay pre  →  agent pre  →  [ Lamaste's step ]  →  agent post  →  relay post
```

- **Install** (hosting the plugin on an agent): the relay can check the target and reserve what it needs, the agent half can prepare its data, then Lamaste creates the internal tunnel; afterwards the agent half can seed, and the relay can check end to end. A failing _pre_ stage stops everything; a failing _post_ stage rolls everything back.
- **Uninstall** (removing the hosting): final backups and deregistration before the tunnel goes, cleanup after.
- **Request** (the forwarded admin API, relay only): validate a request before anything reaches the agent half (`pre-forward`), scan a response before it leaves the relay — redact or block a leaked token (`post-forward`). Lamaste ships a shared **secret scanner** for that.
- **Tunnel state**: when the tunnel (or the application behind it) goes down or comes back, both sides are told; while it is down, the relay can answer with the plugin's own maintenance response instead of a bare 502.

A hook never sees credentials, the installation secret or the network; anything it wants done beyond its answer — an audit entry, a notification, a log line — it asks Lamaste for as an **effect**.

## The manifest

```jsonc
"hooks": {
  "relay": {
    "entry": "hooks/relay.mjs",                 // one bundled ES module inside the relay package
    "effects": ["audit", "notify-admins"],      // effect types the plugin's own hooks may return
    "install":   { "pre-tunnel": { "timeoutMs": 60000 }, "post-tunnel": {} },
    "uninstall": { "pre-teardown": {}, "post-teardown": {} },
    "request": [
      { "stage": "pre-forward", "routes": ["POST /admin/import/*"],
        "body": { "maxBytes": 1048576 }, "timeoutMs": 200, "onError": "reject" },
      { "stage": "post-forward", "use": "lamaste:secret-scan", "routes": ["GET /admin/export/*"],
        "body": { "maxBytes": 5242880 }, "with": { "action": "redact", "packs": ["credentials"] } }
    ],
    "tunnel": { "down": { "timeoutMs": 2000 }, "up": {} }
  },
  "agent": {
    "install":   { "pre-tunnel": {}, "post-tunnel": {} },
    "uninstall": { "pre-teardown": {}, "post-teardown": {} },
    "tunnel":    { "down": {}, "up": {} }
  }
}
```

Only a plugin with `"hosting": "agent"` and an `agent` block may declare hooks. Validation:

| Field                           | Rule                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relay.entry`                   | A relative `.mjs`/`.js` path inside the package; required exactly when the plugin has relay hooks of its own. One self-contained ES module (Node built-ins only). |
| `relay.effects`                 | `audit`, `notify-admins`, `log`. An effect of another type is dropped.                                                                                            |
| install / uninstall `timeoutMs` | default 30 000, at most 120 000                                                                                                                                   |
| `tunnel` `timeoutMs`            | default 2 000, at most 10 000                                                                                                                                     |
| request `timeoutMs`             | default 500, at most 2 000                                                                                                                                        |
| agent stage `timeoutMs`         | default 60 000, at most 300 000                                                                                                                                   |
| request `body.maxBytes`         | at most 10 MiB (and the tunnel's body limit). Without `body` the hook sees headers only.                                                                          |
| request `onError`               | `pre-forward`: `reject` (default, 503) or `continue`; `post-forward`: `block` (default, 502) or `pass`                                                            |
| request `onOversize`            | the same values: what happens when the body is larger than `maxBytes`. Defaults fail closed (413 / 502).                                                          |
| request `routes`                | 1–20 patterns per hook, at most 20 hooks                                                                                                                          |
| `use`                           | `lamaste:secret-scan` (post-forward, with `body`)                                                                                                                 |

### Route patterns

`"<METHOD> <path>"` or `"<path>"` (any method). The method is `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` or `*`; `GET` also matches `HEAD`. The path starts with `/admin` (the forwarded admin API) or `/app` (the user surface — accepted, not active until the plugin gateway exists). A segment is a literal or `*`: one segment, except as the last, where it matches one or more.

Matching errs towards running the hook: literal segments match case-insensitively, segments are compared percent-decoded (`/admin/%69mport` is `/admin/import`), and empty segments are ignored. The forwarder refuses a path with an encoded `/` or `\`.

## Approval

Relay hooks are code Lamaste runs on the relay, and an [agent half Lamaste installs](app-host.md) is code it has an agent's root helper install, so an administrator approves both first. What is approved is one **digest**: SHA-256 over the canonical JSON of the normalised relay declarations (defaults applied, shared-hook settings included) with the SHA-256 of the entry module, and of the agent half pinned for the version — its package, version, tarball integrity, service (`entry`, `memoryMax`) and system packages (`{ v: 2, relay, agentHalf }`, either part `null` when the version brings none). A version whose declarations, module or agent half differ by one byte has another digest. The runner records the relay part's own digest, so a new agent half with an unchanged relay module leaves the runner current.

- Installing a plugin with relay hooks or an agent half Lamaste installs leaves them **pending**: the plugin can be enabled, but not hosted, and its forwarded API answers `503 { code: "hooks_not_approved" }` until the approval.
- **Approving** names the digest the administrator saw; if what the version brings changed meanwhile the panel answers `409` with the current digest.
- **Updating** a plugin whose new version brings another hook set or agent half waits for approval; the installed version stays live. **Auto-approve**, off by default and per plugin, approves such changes automatically — each use is in the audit log — except an agent half change that runs more as root (an agent half where there was none, another agent package, added system packages, another service entry or memory limit) and a version that turns a secret setting into a plain one, whose next value the relay would keep in clear ([withheld](agent-hosted-plugins.md#approval)).
- Agent hooks are the plugin's own code on its own agent and need no approval. Shared hooks are part of the approved set by name and settings; their rules ride Lamaste releases (see below).

Every approval, auto-approve change and auto-approval is recorded in the [audit log](audit-and-notifications.md) with the administrator certificate's serial.

### `GET /api/plugins/:name/hooks`

```json
{
  "hooks": {
    "relay": {
      "digest": "…64 hex…",
      "entry": "hooks/relay.mjs",
      "entrySha256": "…",
      "stages": [{ "stage": "install:pre-tunnel", "timeoutMs": 60000 }],
      "request": [
        {
          "index": 0,
          "stage": "pre-forward",
          "routes": ["POST /admin/import/*"],
          "bodyMaxBytes": 1048576,
          "timeoutMs": 200,
          "onError": "reject",
          "onOversize": "reject",
          "use": null,
          "settings": null,
          "failOpen": [],
          "inactiveRoutes": []
        }
      ],
      "effects": ["audit", "notify-admins"],
      "packs": [],
      "failOpenCount": 0
    },
    "agent": { "stages": [{ "stage": "install:pre-tunnel", "timeoutMs": 60000 }] },
    "agentHalf": {
      "package": "@lamalibre/fx-agent",
      "version": "1.0.0",
      "integrity": "sha512-…",
      "entry": "dist/agentd.mjs",
      "memoryMax": null,
      "systemPackages": [],
      "serviceUser": "lamaste-app-fx",
      "unitName": "lamalibre-app-fx.service",
      "dataDir": "/var/lib/lamalibre/apps/fx"
    },
    "approval": {
      "required": true,
      "state": "pending",
      "digest": "…64 hex: what to approve…",
      "approvedDigest": null,
      "approvedVersion": null,
      "approvedAt": null,
      "approvedBy": null
    },
    "autoApprove": false,
    "runner": { "installedDigest": null, "current": false },
    "pendingUpdate": null
  }
}
```

`failOpen` lists a hook's fail-open settings (`onError`, `onOversize`, `onUnscannable`); the panel highlights them. `relay.digest` is the relay hook set's own digest (what the runner holds); `approval.digest` is the one to approve, covering the relay hooks and `agentHalf` — the agent half Lamaste installs, `null` when there is none or it is installed by hand ([App Host](app-host.md)). `pendingUpdate` is `{ version, digest, stagedAt, relay, agentHalf, settings, autoApproveWithheld }` while an update waits — `settings` lists how the version changes the plugin's [settings schema](agent-hosted-plugins.md#in-the-plugin-list-and-the-update-preview) (`{ added: [{ key, type }], removed: [{ key, type }], retyped: [{ key, from, to }], newRequired: [key], secretToPlain: [key] }`, `null` when neither version declares settings; not part of the digest), and `autoApproveWithheld` why auto-approve did not cover it, in sentences (`null` otherwise).

### `POST /api/plugins/:name/hooks/approve`

`{ "digest": "…" }` — the installed set's digest (`200 { ok, hooks }`) or a pending update's (the update is applied: `202 { ok, operation }`). `409` when the set changed since it was shown.

### `PUT /api/plugins/:name/hooks/auto-approve`

`{ "enabled": true | false }`.

## Updating a plugin

### `POST /api/plugins/:name/update`

`{ "version"?: "1.2.3" | "latest" }` (default `latest`). For agent-hosted plugins. The panel fetches the version with `npm pack` and reads its manifest and relay module **in memory** — nothing of it is installed yet. Then:

- `200 { upToDate: true }` — nothing to do;
- `202 { pendingUpdate }` — what it brings (relay hook set, agent half) differs from what was approved and auto-approve is off or withheld; approve it with the digest shown;
- `202 { operation }` — the update runs: the new hook module goes into the runner, the install pipeline runs with `phase: "upgrade"` around installing the package (agent stages through the tunnel), and a failure restores the previous package, row and module.

The agent half of a hosted plugin whose agent half Lamaste installs is pinned when the version is staged and installed on the agent **first**, after the agent's pre stage; a failure after that activates the version that ran before ([Hosting with an agent half](agent-hosted-plugins.md#the-pipelines)). That is a push: the hosting agent must be eligible for the new version and push install must allow `update` — checked when the update starts, not while it waits for approval.

A version that names another plugin, turns the plugin into a server plugin, or drops the agent half of a hosted plugin is refused (`400`), and so is one that switches a hosted plugin between an agent half installed by hand and one Lamaste installs. `DELETE /api/plugins/:name/update` discards a pending update.

## Operations

Hosting, removing a hosting, an update and the uninstall of a hosted plugin wait on agents and hooks, so they run in the background: the API answers `202 { ok, operation }`. One operation runs per plugin at a time (`409` otherwise).

```json
{
  "id": "…uuid…",
  "plugin": "fx",
  "kind": "host",
  "actor": "admin",
  "status": "running | succeeded | rolled-back | failed | interrupted",
  "steps": [
    { "name": "relay install:pre-tunnel", "status": "done", "startedAt": "…", "finishedAt": "…" },
    {
      "name": "agent install:pre-tunnel",
      "status": "failed",
      "error": "agent install:pre-tunnel refused: no room"
    }
  ],
  "warnings": ["Rolling back: …"],
  "error": null,
  "params": { "agentLabel": "vm1" },
  "startedAt": "…",
  "finishedAt": "…"
}
```

`GET /api/plugins/:name/operations` (newest first) and `GET /api/plugins/:name/operations/:id`. An operation the panel was restarted under is `interrupted`.

## The pipelines

### Install (hosting) and uninstall

| Step       | Install                                                                                                        | Uninstall (rollback: `phase: "rollback"`)                              |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| relay pre  | `install:pre-tunnel` — a failure leaves nothing                                                                | `uninstall:pre-teardown` — a failure stops it unless forced            |
| Lamaste    | reserve: internal tunnel **without** its chisel grant (the port), record and secret (`installing`), capability | —                                                                      |
| Lamaste    | the agent half Lamaste installs (`agent.package`): an `app-install` job ([App Host](app-host.md))              | —                                                                      |
| agent pre  | `install:pre-tunnel` by the agent's sync on its loopback (agent job); a failure releases what was reserved     | `uninstall:pre-teardown` through the tunnel                            |
| Lamaste    | grant the tunnel, wait until the agent half answers through it (150 s)                                         | remove the tunnel (`removing`; the secret stays)                       |
| agent post | `install:post-tunnel` through the tunnel                                                                       | `uninstall:post-teardown` by the agent's sync — a failure is a warning |
| Lamaste    | —                                                                                                              | remove the agent half Lamaste installed (`app-remove`; `purge` too)    |
| Lamaste    | —                                                                                                              | revoke the secret and the capability                                   |
| relay post | `install:post-tunnel`, then the hosting turns `active`                                                         | `uninstall:post-teardown` — a failure is a warning                     |

A failure after the agent's pre stage — or once the agent half's install job was dispatched — rolls back: the uninstall pipeline with `phase: "rollback"` for the sides that took part, then Lamaste's own steps in reverse (an agent half is removed without purge); the operation ends `rolled-back`. Post stages and every uninstall stage must be **idempotent**. `DELETE /api/plugins/:name/hosting?force=true` (and `DELETE /api/plugins/:name?force=true`) passes failing pre-teardown stages — for an agent that is gone — and is recorded; `?purge=true` also deletes the data of the agent half Lamaste installed.

The hosting's **phase** (`installing`, `active`, `removing`) is on the hosting record and in `agent-config`: the forwarder and the health monitor use only `active` hostings.

### Request

The [forwarder](agent-hosted-plugins.md#the-forwarded-admin-api) runs a plugin's approved request hooks on matching routes; other routes stream through untouched.

- **pre-forward**: the request is buffered up to the largest `maxBytes` of the matching hooks; each hook, in declaration order, answers `continue` (with header edits) or `reject` (4xx, never forwarded). A larger body follows `onOversize`.
- **post-forward**: the agent half is asked for an uncompressed response (`Accept-Encoding: identity`); the response is buffered up to `maxBytes`; each hook answers `pass`, `replace` (a new body; `Content-Length` recomputed, `Content-Encoding` and `ETag` dropped) or `block` (5xx with its `reasonId`). A server-sent event stream cannot be checked: a body-reading hook treats it as too large.
- A hook that fails, times out or answers something invalid follows `onError`. A runner that let a hook overrun is restarted.

What a request hook sees: method, path (on the agent half), query, the caller (`admin` or `agent:<label>`), the headers without `Cookie`, `Authorization`, Lamaste's and nginx's own, and the body when declared. Response hooks see status, headers without `Set-Cookie`, and the body.

### Tunnel state

When the [health monitor](agent-hosted-plugins.md#health) sees a hosting go `down` (reason `tunnel` or `app`), Lamaste runs the relay's `tunnel:down`; its `fallback` (`{ status, retryAfter?, contentType?, body? }`) answers forwarded requests that fail while the plugin is down. `tunnel:up` runs when it is back after a `down` (not on the first `up`), and clears the fallback.

The agent cannot see its own chisel session; `agent-config` carries the relay's view (`appPlugins[].health`), and the agent's sync calls the agent half's `tunnel:down` / `tunnel:up` once per change. The panel unreachable for 90 s counts as `tunnel` down on the agent.

## The hook runner

Relay hooks run in `lamalibre-lamaste-hooks@<route>.service`, started by its socket (`/run/lamalibre-lamaste-hooks/<route>.sock`, `root:lamaste` 0660) on the first call and exiting after ten idle minutes. The sandbox:

- a dynamic user, `ProtectSystem=strict`, `ProtectHome`, private `/tmp`, devices, IPC and network namespace, `RestrictAddressFamilies=AF_UNIX`, `IPAddressDeny=any`, no capabilities, `NoNewPrivileges`, `SystemCallFilter=@system-service` minus `@privileged`, `/etc/lamalibre`, `/etc/authelia`, `/etc/letsencrypt`, `/etc/nginx`, `/etc/ssh`, sudoers and shadow inaccessible, empty `/run` and `/var`, 256 MiB, half a CPU, 32 tasks;
- Node's permission model (`--permission`): reads of the runner and the approved module only — no writes, child processes, workers or addons. Node ≥ 22.13 is required; `create-lamaste` upgrades an older Node;
- the environment emptied before the module loads; `console` silenced and the unit's output discarded, so nothing a hook sees reaches the journal.

`lamaste-priv hooks install <route> <sha256|none>` (module on stdin, checked against the approved digest) writes the module root-owned to `/opt/lamalibre/lamaste/hooks/<route>/<sha256>.mjs` and enables the socket; `hooks activate` points back at the previous module (an update's revert); `hooks restart` stops a stuck runner; `hooks remove` disables it and deletes its modules. The panel reinstalls an approved runner at start-up if it is missing.

The protocol between the panel and the runner is one length-prefixed JSON frame each way per connection (`@lamalibre/lamaste/hooks`, `protocol.ts`).

## Writing hooks

```js
// hooks/relay.mjs — bundled into one file (esbuild), Node built-ins only
import { defineRelayHooks } from '@lamalibre/lamaste/hooks';

export default defineRelayHooks({
  'install:pre-tunnel': async (input) =>
    input.agent.label.startsWith('vm-') ? { ok: true } : { ok: false, reason: 'not a VM' },
  'request:pre-forward': (req) =>
    req.body?.json().rows?.length > 0
      ? { action: 'continue' }
      : { action: 'reject', status: 422, body: { error: 'empty import' } },
  'tunnel:down': (state) => ({
    fallback: { status: 503, retryAfter: 60, body: { error: 'maintenance', reason: state.reason } },
    effects: [{ type: 'notify-admins', level: 'warning', message: `down (${state.reason})` }],
  }),
});
```

| Stage                       | Input                                                                                                                                   | Decision                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| install / uninstall         | `plugin`, `version`, `previousVersion` (upgrade), `phase`, `agent.label`, `settings`, `outputs` of earlier stages, `port` once assigned | `{ ok: true, output? }` / `{ ok: false, reason }`                                                                          |
| `request:pre-forward`       | `method`, `path`, `query`, `caller`, `headers`, `route`, `body?`                                                                        | `{ action: 'continue', setHeaders?, removeHeaders? }` / `{ action: 'reject', status: 400–499, body? }`                     |
| `request:post-forward`      | `status`, `headers`, `request`, `route`, `body?`                                                                                        | `{ action: 'pass' }` / `{ action: 'replace', body, contentType?, setHeaders? }` / `{ action: 'block', status?, reasonId }` |
| `tunnel:down` / `tunnel:up` | `state`, `reason`, `since`, `lastError?`                                                                                                | `{ fallback? }` (down) / `{}`                                                                                              |

`settings` in a relay hook's input is the plugin's effective non-secret [settings](agent-hosted-plugins.md#settings) — each stored value or its default, from the relay's cache (`{}` while it never read them); an agent hook gets `{}`, since the agent half holds the settings itself. Neither ever gets a secret.

Every decision may carry `effects` (at most 10): `{ type: 'audit', event, data? }`, `{ type: 'notify-admins', message, level? }`, `{ type: 'log', message, level?, data? }` — rate-limited per plugin (60, 6 and 120 a minute). Header edits may not touch `Host`, framing, `Cookie`/`Set-Cookie`, `Authorization`, `X-Forwarded-*`, `X-Lamalibre-*`, `X-SSL-Client-*`, `Remote-*` or `X-Accel-*`.

### Agent hooks

The agent half answers `POST /admin/hooks/<stage>` (body `{ stage, input }`, answer `{ ok: true, output? }` or `{ ok: false, reason }`). `createAgentHookHandler` from `@lamalibre/lamaste/agent` does the checking — the caller assertion must name Lamaste itself (`{ type: 'lamaste' }`), which no forwarded caller can, and bind the SHA-256 of the exact body (`wrong_body` otherwise), so it needs the body **as received** (a `Buffer` or a string; a parsed object is refused `400` "The body must be passed as received"); the forwarder never reaches `/admin/hooks*`. Send the `status`, `headers` and `bodyText` it returns, `bodyText` byte for byte: its `X-Lamalibre-Responder` header signs those bytes, and the relay counts a hook answer without a valid one as a failure (`unauthenticated`) — see [Authentication between the relay and the agent half](agent-hosted-plugins.md#authentication-between-the-relay-and-the-agent-half):

```js
import { createAgentHookHandler, createCallerAssertionVerifier } from '@lamalibre/lamaste/agent';

const hooks = createAgentHookHandler({
  verifier: createCallerAssertionVerifier({ configPath, plugin: 'fx' }),
  hooks: {
    'install:pre-tunnel': async (input) =>
      (await migrate()) ? { ok: true } : { ok: false, reason: 'migration failed' },
    'tunnel:down': () => queueLocally(),
  },
});
// in the agent half's router, for POST /admin/hooks/* (the body as received):
const out = await hooks.handle({ method, url, headers, body: rawBody });
res.writeHead(out.status, out.headers).end(out.bodyText);
```

The relay calls agent hooks through the tunnel while it exists. Before the tunnel is granted and after it is removed, the relay lists an **agent job** in `GET /api/tunnels/agent-config` (`agentJobs: [{ id, route, kind: "hook", stage, input, timeoutMs, deadlineAt }]`); the agent's sync calls the agent half on its own loopback with the installation secret it holds and reports `POST /api/agents/me/jobs/:id/result` (`{ ok: true, decision }` or `{ ok: false, error }`; hosting agent only, once). A job whose agent half does not answer yet waits for the next sync, until its deadline (timeout plus 90 s).

## The secret scanner (`lamaste:secret-scan`)

A shared `post-forward` hook shipped with Lamaste, configured with Lamaste rule packs only — app-specific rules belong in the plugin's own relay hook.

```jsonc
{
  "stage": "post-forward",
  "use": "lamaste:secret-scan",
  "routes": ["GET /admin/export/*"],
  "body": { "maxBytes": 5242880 },
  "with": { "action": "redact", "packs": ["credentials"], "onUnscannable": "block" },
}
```

| Setting         | Values                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action`        | `redact` (default): each secret becomes `[REDACTED:<ruleId>]`, safe inside a JSON string; `block`: `502` with `reasonId: "secret-scan"`                                                             |
| `packs`         | `credentials` (default: private keys, AWS, GitHub, GitLab, Slack, Stripe, Google, npm, DigitalOcean, Anthropic and OpenAI keys, Feria tokens), `jwt`, `assignments` (`password=…`, `"secret": "…"`) |
| `onUnscannable` | `block` (default) or `pass` (fail-open, shown in the approval): a compressed, binary, non-UTF-8 or non-text body                                                                                    |

Matching runs on the raw text: a JSON-escaped PEM key is found, and nothing but the matched characters changes (a body is never parsed and serialised again). The audit entry (`hook.secret-scan.redacted|blocked|unscannable`) names rule ids, counts and pack versions — never a value. **Rules ride Lamaste releases**: each pack has a version; within a Lamaste major a pack only gains rules; a Lamaste upgrade that changes a pack is audited for every plugin using it (`hooks.rules-updated`) and needs no re-approval.

## CLI

```
lamaste-server plugins hooks <name>                         # the relay hook set, its digest and approval
lamaste-server plugins approve-hooks <name> --digest <sha>  # approve (or approve a pending update)
lamaste-server plugins auto-approve <name> on|off
lamaste-server plugins update <name> [--version <v>]
lamaste-server plugins discard-update <name>
lamaste-server plugins host <name> --agent <label>          # follows the operation
lamaste-server plugins unhost <name> [--force] [--purge]
lamaste-server plugins uninstall <name> [--force] [--purge]
lamaste-server plugins operations <name>
```

## State

| Path                                                     | Contents                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `state.db` `plugins.hooks`, `plugins.hooks_entry_sha256` | The declared hooks and the relay module's digest, read at install                                 |
| `state.db` `plugin_hook_sets`                            | Approval, auto-approve, the runner's module, pack versions, a pending update, the tunnel fallback |
| `state.db` `plugin_operations`, `agent_jobs`             | Operations and their steps; agent jobs and results (a day)                                        |
| `/opt/lamalibre/lamaste/hooks/<route>/`                  | The approved module (`<sha256>.mjs`, root, 0644) and `runner.env`                                 |
| `/run/lamalibre-lamaste-hooks/<route>.sock`              | The runner's socket (systemd)                                                                     |
| `<agent>/agents/<label>/app-plugin-tunnel-state.json`    | What tunnel state the agent last told each agent half (0600)                                      |
