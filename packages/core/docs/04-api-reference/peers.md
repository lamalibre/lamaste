# Calls and Events Between Plugins (Peers)

An application made of many [agent-hosted plugins](agent-hosted-plugins.md) needs its plugins to talk to each other: a domain plugin asks a directory plugin who approves a request, a notices plugin tells people about it, a search plugin learns that a document was published. **Peers** is how: a plugin's agent half **calls** the endpoints another plugin **provides**, as the plugin itself or on behalf of the person whose request it is serving, and **receives the events** other plugins publish — only along the edges a **shelf** grants, and only to the endpoints and events the provider declares. Design: `plugin-development/design/agent-hosted-app-plugins.md`, _Slice 8 as planned_.

## In Plain English

Every call goes through the relay, also when both halves sit on one agent. The relay is the one place that knows who may call what, which version each plugin runs, whether the provider is up, and who the person is — so revoking a grant or disabling a person takes effect on the next call.

An agent half cannot reach the relay on its own. So the relay opens the way: it dials the consumer's half through the consumer's own [internal tunnel](agent-hosted-plugins.md#hosting-endpoints) and turns that connection around — the half then sends its calls over it as HTTP/2 streams (the **peer channel**). Nothing new listens anywhere. The relay checks each call, then forwards it to the provider's half with a signed `peer` caller assertion, exactly as the panel forwards an administrator's request.

Events are kept by the provider: it writes each event in the same database transaction as the change it describes (an **outbox**). The consumer pulls them over its peer channel; the relay checks the grant, fetches them from the provider and passes them on. The consumer applies each event and remembers how far it got in one transaction. The relay stores no event and no application data.

## The manifest block

Only for `hosting: "agent"` with an `agent` block.

```json
"peers": {
  "provides": {
    "directory:read": {
      "description": "Read people and organisation units",
      "majors": [1, 2],
      "endpoints": [
        { "method": "GET", "path": "/units/:unitId" },
        { "method": "GET", "path": "/people/:userId/manager" },
        { "method": "POST", "path": "/people/lookup", "majors": [2] }
      ],
      "events": ["person.unit-changed", "unit.renamed"]
    }
  },
  "consumes": {
    "directory:read": {
      "required": true,
      "reason": "Approvers come from the organisation chart",
      "major": 1,
      "events": ["person.unit-changed"]
    },
    "notices:send": { "required": false, "reason": "Tell approvers" }
  }
}
```

| Field                                  | Rule                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scope                                  | `<route>:<name>`, each side a DNS label of 1–32. A plugin provides only scopes of its own route (the scope names its provider) and consumes only other plugins'. A route may not be a reserved API prefix (`notifications`, `users`, `identity`, …): name plugins around them    |
| `provides.<scope>.description`         | 1–200 characters, no control or bidirectional-override characters                                                                                                                                                                                                                |
| `provides.<scope>.majors`              | The API majors served, 1–999, at most 8, default `[1]`                                                                                                                                                                                                                           |
| `provides.<scope>.endpoints`           | 1–64. `method`: `GET HEAD POST PUT PATCH DELETE` (`GET` also admits `HEAD`). `path` on the provider half's `/peer` surface, ≤ 200 characters: literal segments `[A-Za-z0-9._~-]+` (not `.`/`..`), `:name` (one segment), a final `*` (one or more). `majors` narrows the scope's |
| `provides.<scope>.events`              | 0–64 event types: 1–64 characters, dot-separated lower-case words                                                                                                                                                                                                                |
| `consumes.<scope>.required` / `reason` | Whether the plugin works without it; why it needs it (1–200 characters)                                                                                                                                                                                                          |
| `consumes.<scope>.major`               | The major the plugin speaks, default 1                                                                                                                                                                                                                                           |
| `consumes.<scope>.events`              | The subscription: event types of the scope it receives (only those the provider publishes are delivered)                                                                                                                                                                         |

Up to 32 provided and 64 consumed scopes. Two endpoints of one scope that differ only in parameter names are the same endpoint and refused.

**Matching errs towards refusing.** The path is matched as the request carries it, case-sensitively: a literal segment only byte for byte and without any `%`-escape, a `:name` or `*` segment may carry escapes but none that the [user surface's path rule](../01-concepts/security-model.md#5f-users-of-agent-hosted-plugins-who-attests-what) refuses (`.`/`..`, a backslash, an encoded `.`, `/`, `\` or `%`). When several endpoints match, the most specific one is the match — as the provider's router chooses.

**Approval.** `peers` is in the [approval digest](agent-hosted-plugins.md#approval) when declared (digests of plugins without it are unchanged). An update waits for an administrator — auto-approve never covers it — when it **widens** the block (`peers.changed`: a consumed scope, another major, a subscription, a provided scope, endpoint, event or major) or **breaks** a granted consumer (`peers.breaks`: a scope, major, endpoint or event an effective edge relies on, gone). `pendingUpdate.peers` is `{ before, after, diff, breaks }`; narrowing alone only changes the digest. A plugin installed on 4.12 had its `peers` block stripped: it takes effect at its next update and approval.

## Applied shelves

A plugin may call another only along an **edge** — consumer → scope — that an **applied shelf** grants. A shelf is a named scope graph, the `scopes` block of a [Shelf](https://github.com/lamalibre/shelf) manifest: `{ "<scope>": { "provider": "<route>", "consumers": ["<route>", …] } }`. Shelf applies one from its page, from the administrator's browser; the CLI and the Peers page take it from a file. Lamaste stores the edges and enforces them; it needs no Shelf code.

An edge is **effective** while the consumer's and the provider's installed, approved versions declare it (the consumer consumes the scope, the provider provides it, in a major the consumer speaks); otherwise it is **pending**, with the reason: `consumer_not_installed`, `provider_not_installed`, `not_consumed`, `not_provided`, `consumer_not_approved`, `provider_not_approved`, `major_mismatch`.

All endpoints are admin only (an administrator certificate; never a plugin's capability).

### `GET /api/peers`

```json
{
  "shelves": [
    {
      "shelfId": "company-ops",
      "appliedAt": "2026-11-10T10:00:00.000Z",
      "appliedBy": "admin",
      "edges": [
        {
          "scope": "directory:read",
          "provider": "directory",
          "consumer": "leave",
          "state": "effective",
          "grantedSeq": 3
        },
        {
          "scope": "directory:read",
          "provider": "directory",
          "consumer": "expenses",
          "state": "pending",
          "reason": "consumer_not_approved",
          "grantedSeq": 4
        }
      ]
    }
  ],
  "plugins": [
    { "name": "directory", "route": "directory", "approved": true, "provides": {}, "consumes": {} }
  ],
  "edges": [
    {
      "consumer": "leave",
      "scope": "directory:read",
      "provider": "directory",
      "major": 1,
      "required": true,
      "events": ["person.unit-changed"],
      "epoch": "…"
    }
  ],
  "channels": { "leave": { "state": "attached", "since": 1762768800000, "lastError": null } },
  "readiness": {
    "leave": { "version": "1.0.0", "consumer": true, "inbox": true, "answeredAt": "…" }
  }
}
```

`edges` (top level) are the effective ones; `epoch` identifies a subscription (the edge's grant and the event types it covers — see [Events](#events)).

### `PUT /api/peers/shelves/:shelfId`

Body `{ "scopes": { … } }` — replaces that shelf's edges, in one transaction. `shelfId` is a DNS label.

| Status | `code`           | Why                                                                                                                                                                                      |
| ------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    |                  | A shelf id that is not a DNS label, a scope whose namespace is not its provider, a consumer that is its provider                                                                         |
| 409    | `not_declared`   | An installed consumer does not consume the scope, or an installed provider does not provide it                                                                                           |
| 409    | `major_mismatch` | The consumer speaks a major the provider does not serve                                                                                                                                  |
| 409    | `cycle`          | The **required** edges of every applied shelf together would form a cycle (named). Optional cycles are allowed: platform plugins that consume each other optionally are the normal shape |

Edges naming a plugin not installed yet are kept, pending. An edge kept from the shelf's previous version keeps its grant; an edge removed and granted again (by no shelf in between) is a new grant. Audit `peer.shelf.applied` (counts).

### `DELETE /api/peers/shelves/:shelfId`

Removes the shelf's edges; calls and subscriptions only it granted stop at once. Audit `peer.shelf.removed`.

### Removing a provider others rely on

`DELETE /api/plugins/:name` and `DELETE /api/plugins/:name/hosting` answer `409 peer_dependents` with `consumers: [{ consumer, scopes, required }]` (required first) when edges consume what the plugin provides — effective ones, and those pending only because the provider is disabled — unless `breakPeers=true`.

A **disabled** plugin calls and serves nobody: its edges are pending (`consumer_disabled`, `provider_disabled`), its channel is closed at once, and its open calls end. The approval preview of an installation or update (`hookStatus.peers.appliedEdges`, `pendingUpdate.peers.appliedEdges`) lists the applied edges that name the plugin's route, in and out, whatever their state — a grant made before a plugin was installed under that route included. `force=true` never implies it: it lets failing pre-teardown stages pass, nothing more.

## The peer channel

For each consumer — installed, its approved version consuming a scope, hosted, active, up and [peer-ready](#peer-readiness) — the relay keeps one channel:

1. `GET /admin/peers/attach` to the consumer's half through its internal tunnel, `Connection: Upgrade`, `Upgrade: lamaste-peers/1`, a `lamaste` caller assertion.
2. The half answers `101 Switching Protocols` with its responder signature over the empty body; anything else is a failed attach.
3. The connection carries HTTP/2 with the roles reversed: the half is the client, the relay a server that never listens. Every stream on it is the consumer's.

64 concurrent streams, a 16 KiB header list, PING every 20 s (closed after 10 s without an answer). The relay reattaches with backoff (1 s → 30 s) while the preconditions hold. When the consumer no longer qualifies — disabled, unhosted, health down, not ready, consuming nothing — the relay closes the channel at once, calls in flight included; and every stream is refused (`403 not_granted`) while the consumer does not qualify, even on a channel not closed yet. A secret rotation the agent acknowledged, or a new attach, **replaces** it: the relay attaches anew and sends `GOAWAY` on the old one, whose calls in flight finish there.

## A call

A stream on the channel: `:method`, `:path` = the provider-relative path and query, and

| Header                     | Meaning                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `x-lamalibre-peer-scope`   | The scope called (it names the provider)                                                                     |
| `x-lamalibre-delegation`   | On behalf of a person: the delegation the half received with their request ([below](#on-behalf-of-a-person)) |
| `x-lamalibre-peer-hops`    | The hop count of the request being served (`0` without one); a call goes at most 4 hops                      |
| `x-lamalibre-peer-timeout` | How long to wait for the provider's headers, in ms (default 30 000, at most 120 000)                         |

The relay decides in this order; each refusal is JSON with `peer: { code }` (and `x-lamalibre-peer-relay`), so the SDK tells the relay's refusals from the provider's own answers:

| Status | `code`                                                              | Why                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `bad_path` / `bad_request`                                          | Not origin-form, an unsafe segment; a malformed header                                                                                                                                            |
| 508    | `hop_limit`                                                         | More than 4 hops                                                                                                                                                                                  |
| 403    | `not_granted`                                                       | No effective edge consumer → scope. An unknown scope or an uninstalled provider answers the same: a consumer learns nothing of what is installed                                                  |
| 403    | `endpoint_not_allowed`                                              | No endpoint of the provider's approved declaration matches the method and path in the consumer's major                                                                                            |
| 401    | `delegation_invalid`                                                | The delegation does not verify, is expired, too deep, or was given to another plugin                                                                                                              |
| 403    | `user_not_entitled`                                                 | The person is disabled or removed, no longer in the root plugin's audience, or the provider does not declare `identity` or does not hold them                                                     |
| 503    | `peer_unavailable`                                                  | `reason`: `not_hosted`, `down_tunnel`, `down_app`, `not_ready`, `busy` (128 calls already open to the provider, `Retry-After: 1`); with `Retry-After`. Nothing is sent while the provider is down |
| 503    | `hooks_not_approved`                                                | The provider declares relay hooks that are not approved                                                                                                                                           |
| 4xx    | `hook_rejected`                                                     | A provider's request hook refused it                                                                                                                                                              |
| 413    | `too_large`                                                         | The body exceeds the provider's [request body limit](agent-hosted-plugins.md#request-body-limit)                                                                                                  |
| 409    | `version_mismatch`                                                  | Only the race of an update between the edge check and the forward                                                                                                                                 |
| 502    | `provider_unreachable` / `provider_unauthenticated` / `hook_failed` | The provider's tunnel or answer failed; an answer without a valid responder signature                                                                                                             |
| 504    | `timeout`                                                           | No headers in time                                                                                                                                                                                |

Then the call is forwarded — through the provider's approved [request hooks](lifecycle-hooks.md) (route patterns may name the `/peer` surface) — to `127.0.0.1:<provider port>/peer<path>` with a caller assertion naming a `peer` caller, streaming both ways (SSE unbuffered, bodies counted against the limit), the headers filtered as the [forwarded admin API](agent-hosted-plugins.md#the-forwarded-admin-api) filters them, HTTP/2 pseudo-headers never passed on, nor a provider's `host` or `http2-settings`. One log line per call: consumer, provider, scope, method, the endpoint pattern, status, duration. Refusals are audited `peer.call.denied` (consumer, scope, code; once a minute per triple; a scope that was not granted is recorded as none, so made-up scopes cannot buy rows), within an allowance of 20 per consumer refilled at 20 a minute: past it a refusal is answered but neither audited nor logged, and the next audited one carries `suppressed` — how many were not.

**Open answers.** An answer stays open at most an hour (a stream, a slow download); a call on behalf of a person ends when its delegation lapses (5 minutes after the request it came with). Every 5 seconds the relay checks each open call again — the edge still effective, the consumer still qualifying, the person still active and in both audiences — and ends it when that no longer holds: the stream is reset and the provider's request cancelled, whether or not it had answered.

### The `peer` caller

```json
{
  "type": "peer",
  "peer": "leave",
  "scope": "directory:read",
  "major": 1,
  "endpoint": "GET /people/:userId/manager",
  "hops": 1,
  "user": { "userId": "…", "username": "ayse", "roles": ["viewer"] }
}
```

Valid only for paths under `/peer`, and no other caller is valid there (however a router could spell it) — the `/app` rule applied to a second surface. `endpoint` is the pattern the relay matched: the provider's SDK refuses a request whose own route is not that pattern, so an allowlisted `/units/:unitId` never runs a route `/units/export` the provider also registered. A half built before 4.13 refuses the `peer` kind; the relay never sends it one ([readiness](#peer-readiness)).

### On behalf of a person

When the relay forwards a person's request to a plugin's `/app/*` and that plugin has an effective outgoing edge, it adds `x-lamalibre-delegation`: a token only the relay can verify (HMAC-SHA256 under a relay key in `<stateDir>/peer-delegation-keys.json`, 0600, rotated daily with the previous kept), naming the plugin it was given to (`holder`), the plugin the person used (`root`), the person's `userId`, a depth, and lasting **5 minutes**. Every request gives a fresh one. It means "this person made a request through `root` a few minutes ago" — no more.

A call presenting it names the person to the provider only when the token verifies, its holder is the calling plugin, the person is active in the directory and still in `root`'s audience, and the **provider declares `identity` and its audience holds them** — then `user` is `{ userId, username, roles }` with their roles **in the provider**. Otherwise `403 user_not_entitled`: nothing about a person reaches a plugin that does not declare identity, or one whose audience does not hold them (its erasure feed would never reach that record). Work without a person — a schedule, an event handler — calls as the plugin itself.

A provider that itself has an effective outgoing edge receives a delegation for its own onward calls (holder the provider, depth + 1, at most 3, never outliving the one it came from).

## Events

**Outbox (provider).** `createPeerOutbox({ db, dbPath, peers })` keeps `lamaste_peer_outbox` and a stream id in the half's SQLite database (WAL). `publish({ scope, type, key, data })` runs on the application's connection inside the transaction of the change: an event exists exactly when the change committed. Reads use a read-only connection of the outbox's own, so a pull never sees an uncommitted row. Scopes and types must be declared; `data` is JSON of at most 16 KiB (events are thin — ids and what changed; fetch the rest with a call); `key` names what the event is about. Events are kept 7 days by default (`retentionDays`); the **horizon** is the highest `seq` pruned.

**Pull.** The consumer's SDK runs one pull per subscribed scope over its channel (`POST /.lamaste/events`). The relay checks that an effective edge with a subscription exists (`403 not_granted`), allows one open pull per consumer and scope (`429 too_many_pulls`), and computes the subscription's **epoch** — the edge's grant with the event types both approved versions share. Then:

- no cursor yet, another epoch, another stream id, a cursor behind the horizon, or a cursor below the **floor** → a **gap**: `reason` `initial`, `granted`, `subscribed`, `stream_changed` or `horizon`, and `resumeFrom` (the provider's head). A first contact, a new or renewed grant and a new subscription start at the head: the consumer neither receives what it had no grant for nor misses the start silently;
- otherwise the relay asks the provider (`POST /admin/peers/events/pull`, Lamaste's own call, the answer authenticated over its body), waits up to 25 s at the head, checks the events against the scope and types it asked for — and the grant, the consumer and the floor once more, since a revocation may have landed while the provider held the pull — and answers `{ to, events, head, epoch, streamId }` — at most 256 events, 1 MiB.

**Floors.** Every gap the relay answers records, in its state store (`peer_event_floors`, one row per consumer and scope), the `resumeFrom` it gave, with the epoch and stream it gave it for. A pull whose cursor is below that floor, or that names an epoch and stream the relay gave no gap for, gets a gap again (`granted` or `initial`). The epoch is no secret — without the floor a consumer could ask from an old cursor, or from the horizon, and read what was published before its grant. A floor is a number, not an event; floors of subscriptions no longer effective are pruned.

**Inbox (consumer).** Handlers registered with `peers.on(scope, type, handler)` run **synchronously in the transaction** that advances the cursor (`lamaste_peer_cursors`, one row per scope): applying an event and remembering it are one step, so delivery is at least once and in order per scope, and idempotent by the cursor. A handler that must call out records the work in its own table and does it afterwards. On a gap, in this order: the SDK records the gap, pulls nothing more for that scope, calls `onGap({ provider, scope, reason })` — your reconcile through the provider's endpoints — retries it with backoff until it resolves (after a crash too), then moves the cursor to `resumeFrom`. Events after that arrive again; handlers must tolerate seeing a change the reconcile already reflected. An application sharing the database must not hold a transaction across an `await`.

An offline consumer or provider simply waits: catching up from the cursor is the normal path.

**A provider restored from a backup renews its stream (4.14.2).** A restored database takes the outbox back to the backup: its stream id and `seq` values are the backup's, so the outbox gives out again the `seq` values it had already given after the backup. A consumer whose cursor is past the restored head is told `stream_changed` by a relay from 4.14.2 on (see below). A consumer that was away until new events carried the head past its cursor is not told anything, whatever the relay: it continues from `seq` values that now name other events, and never sees the ones in between. So a provider's restore procedure gives its outbox a new stream before the agent half serves events again:

```js
import { DatabaseSync } from 'node:sqlite';
import { renewPeerOutboxStream } from '@lamalibre/lamaste/agent';

// The agent half stopped, its database restored: the plugin's restore step.
const db = new DatabaseSync(path.join(dataDir, 'data.db'));
renewPeerOutboxStream(db); // → { streamId, head, horizon }, or null: no outbox in this database
db.close();
```

Run the restore step as the plugin's own account, with the agent half stopped and under the same protections as its unit — `systemd-run --wait --pipe -p User=<account> -p ProtectSystem=strict -p ReadWritePaths=<data dir> -p PrivateNetwork=yes …` — from a small entry point of its own rather than the half's main module. Copy the backup into place as that account too: the data directory is the account's, and root acting on a path there could be made to follow a link. `renewPeerOutboxStream` takes SQLite's write lock: with the half still writing it fails with SQLite's own busy error. A running half can call `outbox.renewStream()` instead; pulls it holds open answer at once. With a new stream id, every consumer's next pull is answered the gap `stream_changed` at the provider's head, whatever its cursor, and `onGap` reconciles through the provider's endpoints. The new stream begins at the head (`horizon` is raised to it); events are neither deleted nor renumbered. Both run in their own `BEGIN IMMEDIATE`: call them outside the application's transaction. Renew after anything that can take the database back: a restore, a copy from another machine, a rollback by snapshot. Renewing when nothing was restored costs the consumers one reconcile, and nothing else.

A consumer **ahead of the head** — its cursor past the provider's head, as after a restore with nothing written since — is answered `stream_changed` at once from relays 4.14.2 on, renewed or not. An outbox answers such a pull with `to` at its head (before 4.14.2 it named the cursor), and the relay reads either answer as the head. On the cursor's own stream the relay then sets the consumer's floor to that head even when the floor was above it (a gap given after the backup): the events between no longer exist, and what the provider writes from there is written after the grant. A relay from 4.13 to 4.14.1 refuses both answers (`502 provider_unreachable`), so the consumer retries until the provider's head passes its cursor, and is then told `stream_changed` if the stream was renewed.

The SDK backs off when gaps come one after another with no events between them (from 1 s, doubling to 30 s): each gap costs a reconcile through the provider's endpoints.

## A consumer's own edges

A consumer's half can learn which of the scopes it consumes are granted to it before it calls (4.14.1), so a plugin that may use one of several providers knows which one it has.

```js
const peers = createPeers({ configPath, plugin: 'notify', db });
peers.onEdgesChanged(({ consumes }) => pickProviders(consumes));
const { known, confirmedAt, consumes } = peers.edges();
// consumes: [{ scope: 'mailer:send', provider: 'mailer', major: 1, required: false,
//              events: [], effective: true, reason: null }, …]
```

- **One entry per scope the half's installed, approved version consumes.** `effective` means an applied shelf grants the edge and both sides' approved versions agree on it (the scope provided, the major served, both enabled). It is not a health check: a call to an effective scope can still be answered `503 peer_unavailable`. `events` lists the event types the edge carries.
- **`reason`** is null when the edge is effective. `not_granted` means no applied shelf names the edge. Otherwise it is why an applied grant is pending: `provider_not_installed`, `not_provided`, `provider_disabled`, `provider_not_approved` or `major_mismatch`. `consumer_disabled` appears only for the moment before a disabled consumer's channel closes. A consumer that is not installed or not approved has no channel, so it reads no list. A newer relay may add reasons, and new fields, which an older SDK ignores.
- **`known`** is false until the relay has answered once since the half started. Nothing is persisted, so a restarted half does not report a stale grant. `confirmedAt` is when the relay last confirmed the list. It advances at least every 25 s while the channel is up; while the channel is down (`connected()`), it stops and the last list is kept.
- **`onEdgesChanged(listener)`** returns an unsubscribe. It is called when the list first becomes known and after every change: a shelf applied or removed, an install, update, approval, enable or disable on either side, a provider uninstalled. The first use of `edges()` or `onEdgesChanged()` starts the reading.
- **On the wire:** `POST /.lamaste/edges` `{ digest, waitMs }` on the half's peer channel → `{ digest, consumes }` (the list sorted by scope, and its SHA-256). The half reads at once on every new channel. The digest is the relay's change token, sent back as given and never recomputed. The half then keeps one request held. A newer read from the same consumer replaces the held one, which is answered at once, and a read held on a replaced channel is cancelled. The relay answers when the list's digest changes, woken by any change to the effective edges and by its tick, or otherwise after 25 s. A relay from before 4.14.1 answers `400 bad_path`; the half then stops asking until the next attach.

## Peer readiness

`GET /admin/peers` (Lamaste's own call) → `{ protocol: 1, consumer, outbox: { streamId, head, horizon } | null, inbox }`. The relay attaches to, forwards to and pulls from only a half that answered protocol 1 for its installed version (asked after hosting, an update, an approval, each health transition to up, and on a tick).

## The SDK

From `@lamalibre/lamaste/agent`. A consumer:

```js
import { createCallerAssertionVerifier, createPeers, peerSurface } from '@lamalibre/lamaste/agent';

const verifier = createCallerAssertionVerifier({ configPath, plugin: 'leave' });
const peers = createPeers({
  configPath,
  plugin: 'leave',
  verifier,
  db, // node:sqlite DatabaseSync: the inbox's cursors
  onGap: async ({ provider, scope }) => resyncFrom(provider, scope),
});
peers.on('directory:read', 'person.unit-changed', (event, db) => {
  db.prepare('UPDATE approvers SET stale = 1 WHERE user_id = ?').run(event.key);
});
await app.register(peerSurface({ verifier, peers })); // /admin/peers*, before other routes
await app.listen(agentHalfListenTarget());
peers.attach(app.server); // or peers.handleUpgrade(req, socket, head) beside other upgrades

// in an /app route, on behalf of the person asking:
const manager = await peers.json('directory:read', 'GET', `/people/${caller.userId}/manager`, {
  onBehalfOf: request,
});
```

`call()` returns `{ status, headers, body, finished(), buffer(), text(), json() }` with the body streaming; `json()` requires a 2xx JSON answer. A body counts only when the provider ended it: `buffer()`, `text()` and `json()` reject with `aborted` when the call's `signal` aborted it, and with `truncated` when its stream was reset before its end (the provider failed mid-body, the channel went away) — never resolve with what arrived so far. An HTTP/2 stream closed by a reset ends its readable side without an error, so a caller reading `body` itself awaits `finished()` after the end, which rejects the same way. A call aborted before its answer rejects with `aborted` too. A refusal or failure rejects with `PeerCallError` (`code` as in the table above, `status`, `retryAfter`, or `relay_unavailable` when no channel came within `attachWaitMs`, default 5 s, or the channel died under the call). The half PINGs its channel every 20 s, and also before a call on a channel it has not heard from for 5 s; one that does not answer within 10 s is dropped and its calls fail at once with `relay_unavailable` — a channel runs through chisel on both machines and can die without a FIN — and the relay attaches a new one. `from: request` passes on only the hop count, `onBehalfOf: request` the delegation too.

A provider:

```js
import { createPeerOutbox, peerRoute, peerSurface } from '@lamalibre/lamaste/agent';

const outbox = await createPeerOutbox({ db, dbPath, peers: manifest.peers });
await app.register(peerSurface({ verifier, outbox }));
app.get(
  '/peer/people/:userId/manager',
  peerRoute(
    async (request, caller) => {
      // caller: { peer, scope, major, endpoint, hops, user?: { userId, username, roles } }
      return lookupManager(request.params.userId);
    },
    { scope: 'directory:read' },
  ),
);

db.exec('BEGIN');
moveToUnit(userId, unitId);
outbox.publish({
  scope: 'directory:read',
  type: 'person.unit-changed',
  key: userId,
  data: { unitId },
});
db.exec('COMMIT');
```

`peerSurface` refuses every `/peer` request a route made by `peerRoute` does not answer (fail closed); `peerRoute` verifies the `peer` caller, checks its `endpoint` against the route — and, with `{ scope }` (one scope or several), that the call was made under the route's scope — and signs every answer. **The caller is verified before the body is read:** all of that runs in the route's own `onRequest` hook, once per request (the verifier burns the assertion's nonce, so a second `verify()` of the same request is a replay), and Fastify reads and parses the body only after it passed. A refusal is `401` (unsigned), `403` (signed), or `503` when the half has no configuration to verify with yet, and a refused request that carries a body is answered `Connection: close`, so its upload is never read to its end. From `preParsing` on, `peerCallerOf(request)` gives the verified caller to a hook of the provider's own. To add options spread `peerRoute`'s (`{ ...peerRoute(handler), bodyLimit }`); to add hooks, keep its own in arrays: its `onRequest` first (`onRequest: [options.onRequest, mine]`), its `onSend` anywhere. A `/peer` route that lost them, runs a hook before them, or carries another `peerRoute()`'s hooks fails its registration. **Register `peerSurface` before any `/peer` route:** registering it after one fails, and a `/peer` route registered after it that is not a `peerRoute` fails its registration — the half does not start with an unchecked route on its peer surface. Routes elsewhere (`/admin/*`, `/app/*`) may come first. A half without Fastify uses `createPeerAdminHandler` for `/admin/peers*`.

## In the panel and the CLI

The plugin card's **Peers** section shows what the plugin provides and consumes, the applied edges into and out of it (pending ones with the reason and the granting shelves), its channel and whether its half is ready; the approval preview shows the peers block, its diff and what an update breaks; uninstalling or unhosting a provider others rely on asks first, naming them. The **Peers** page lists applied shelves with their edges and the channels, removes a shelf and applies one pasted as JSON.

```bash
lamaste-server peers list
lamaste-server peers apply company-ops --file scopes.json
lamaste-server peers remove company-ops
lamaste-server plugins uninstall directory --break-peers
```

`AdminClient`: `getPeers()`, `applyPeerShelf(shelfId, scopes)`, `removePeerShelf(shelfId)`, and `breakPeers` on `uninstallPlugin` / `clearPluginHosting`.
