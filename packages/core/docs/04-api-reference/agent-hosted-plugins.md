# Agent-Hosted Plugins

An **agent-hosted plugin** is an application that runs on one of your agents — typically a VM — while its admin pages live in the Lamaste panel. Lamaste never runs the plugin's code on the relay. This page covers what Lamaste adds for a plugin whose manifest has an `agent` block: hosting it on an agent, the internal plugin tunnel, the forwarded admin API, the installation secret and the health monitor. The hooks a plugin can run around all of these — and their approval — are in [Lifecycle Hooks](lifecycle-hooks.md). The full design is `plugin-development/design/agent-hosted-app-plugins.md`.

## In Plain English

The plugin has two halves. The **agent half** is the application: it runs on the hosting agent, listens on the agent's loopback and holds the data. The **panel** serves the plugin's pages and forwards every call under `/api/<route>/` to the agent half, over a tunnel that exists only on the relay's loopback — no hostname, no certificate, no DNS. Each forwarded call carries a signed **caller assertion** naming who the panel admitted, so the agent half trusts the panel and nothing else that can reach the relay's loopback.

Hosting a plugin on an agent does three things at once: it creates the internal tunnel (Lamaste picks the port), issues the installation secret, and grants the agent's certificate the capability that lets it — and only it — fetch that secret. The agent's sync timer fetches the secret within about 30 seconds and hands it to the agent half; from then on the panel's pages work.

## The manifest

```json
{
  "name": "market-indicators",
  "version": "1.0.0",
  "hosting": "agent",
  "agent": { "requires": { "node": ">=22", "os": ["linux"] } },
  "capabilities": ["plugin:market-indicators:use"],
  "panel": {
    "pages": [{ "path": "/indicators", "title": "Indicators" }],
    "apiPrefix": "/api/market-indicators"
  }
}
```

| Field            | Meaning                                                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hosting`        | `"agent"`. Lamaste never imports the package.                                                                                                                                                                                                                  |
| `agent`          | The plugin has an agent half Lamaste connects to. Only accepted with `hosting: "agent"`. Without it the plugin is identity only (OIDC clients and capabilities, as Feria), and may not declare a panel.                                                        |
| `agent.requires` | Optional. `node` (a semver range), `os` (`linux`, `darwin`), `systemPackages`. Validated now; checked against the hosting agent's platform once Lamaste installs the agent half onto the agent itself. Hosting an agent half installed by hand checks nothing. |
| `panel`          | Allowed with an `agent` block: the pages are listed in the panel, and the bundle at `/api/<route>/panel.js` comes from the agent half (`/admin/panel.js`).                                                                                                     |
| `hooks`          | Lifecycle hooks on the relay and in the agent half — see [Lifecycle Hooks](lifecycle-hooks.md).                                                                                                                                                                |

There is no port in the manifest: Lamaste assigns it when the plugin is hosted.

## Hosting endpoints

All admin only.

### `POST /api/plugins/:name/hosting`

```json
{ "agentLabel": "vm1" }
```

Hosts the plugin on an enrolled machine agent: starts the plugin's **install pipeline** as an operation and answers `202 { ok, operation }` (follow it at `GET /api/plugins/:name/operations/:id`). Around the plugin's [install hooks](lifecycle-hooks.md#the-pipelines), Lamaste reserves the internal tunnel — the lowest free port of **21000–21999** (the range Lamaste reserves for internal tunnels; a tunnel created by hand may not use it), without its chisel grant yet — a hosting record with a fresh 32-byte installation secret (phase `installing`), and `plugin:<route>:host` on the agent's certificate; the agent fetches its config; then the tunnel is granted and Lamaste waits until the agent half answers through it, and the hosting turns `active`. A failure rolls back to nothing.

| Status | Reason                                                                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | The plugin is a server plugin or has no `agent` block; the agent is unknown, revoked or a plugin-agent certificate; the relay is not onboarded                       |
| 404    | Plugin not installed                                                                                                                                                 |
| 409    | The plugin is already hosted (a plugin has one hosting agent); another operation of the plugin runs; its relay hooks are not approved (`code: "hooks_not_approved"`) |

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
  "phase": "active"
}
```

`phase` is `installing` (the install pipeline runs: secret delivered, tunnel not yet granted), `active`, or `removing` (the uninstall pipeline runs: tunnel gone, secret not yet). The forwarder and the health monitor use only active hostings.

### `GET /api/plugins/:name/hosting`

The record above, with the health the monitor observed last (`checkedAt` and `lastError` while it is not up). `404` when the plugin is not hosted. `GET /api/plugins` and `GET /api/plugins/:name` carry the same record as `agentHosting` (`null` when not hosted).

### `DELETE /api/plugins/:name/hosting`

Starts the plugin's **uninstall pipeline** as an operation (`202 { ok, operation }`): its pre-teardown hooks, the tunnel removed (its chisel grant withdrawn), the agent's post-teardown hook while the agent still holds the secret, then the secret, the record and the capability (the agent's sync deletes its config file). `?force=true` lets failing pre-teardown hooks pass — for an agent that is gone — and is recorded in the audit log. Uninstalling a hosted plugin (`DELETE /api/plugins/:name`, which then answers `202` with its operation) runs the same pipeline first.

### `POST /api/plugins/:name/hosting/rotate-secret`

Issues a new installation secret (10 per minute). The secret in use becomes the _previous_ one and the panel keeps signing with it until the hosting agent acknowledges the new one — so no request is ever signed with a secret the agent half cannot verify. The agent's sync fetches and acknowledges within about 30 seconds; the response shows `rotationPending: true` until then.

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

### What the agent does with it

`GET /api/tunnels/agent-config` lists the plugins hosted on the calling agent:

```json
"appPlugins": [
  {
    "route": "market-indicators", "port": 21000, "secretIssuedAt": "…", "secretAcknowledged": true,
    "phase": "active",
    "health": { "state": "up", "since": "…" },
    "agentHooks": [{ "stage": "tunnel:down", "timeoutMs": 60000 }]
  }
],
"agentJobs": []
```

`health` is the relay's view of the tunnel (the agent cannot see its own chisel session); the sync calls the agent half's `tunnel:down` / `tunnel:up` when it changes. `agentJobs` are agent hook calls the sync makes on the agent's loopback while there is no tunnel — see [Lifecycle Hooks](lifecycle-hooks.md#agent-hooks).

`lamaste-agent sync` (the 30-second timer) fetches a plugin's config when it does not hold the secret issued at `secretIssuedAt`, writes `~/.lamalibre/lamaste/agents/<label>/app-plugins/<route>.json` (0600, atomic), acknowledges it, and removes the file of a plugin the relay no longer lists. `sync.log` records `plugin config fetched: <route>`.

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
lamaste-server plugins hosting <name>                 # agent, port, secret state, health
lamaste-server plugins host <name> --agent <label>    # host the plugin (follows the operation)
lamaste-server plugins unhost <name> [--force]        # remove the hosting
lamaste-server plugins rotate-hosting-secret <name>   # new installation secret
```

`lamaste-server plugins list` shows where each hosted plugin runs and its health.

## State

| Path                                              | Contents                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `/etc/lamalibre/lamaste/plugin-hostings.json`     | Hosting records with their secrets (0600, atomic, one per plugin) |
| `/etc/lamalibre/lamaste/tunnels.json`             | The internal tunnel, like every tunnel                            |
| `<agent>/agents/<label>/app-plugins/<route>.json` | The agent's copy of the port and secret (0600)                    |

Secrets leave the relay only through `GET /api/agents/me/plugin-config/:route`, over TLS, to the hosting agent's certificate.
