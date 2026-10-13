# Lamaste Identity Directory — Design Document

> **Status:** design, 2026-10-13. Nothing here is implemented yet.
> **Package:** `@lamalibre/lamaste-identity` (completes the existing SDK).
> **Companions:** `gatekeeper-design.md` (authorization),
> `plugin-development/design/agent-hosted-app-plugins.md` (app plugins).

## Goal

Lamaste becomes the **directory** for every application in the ecosystem, the
way Active Directory is for a Windows estate:

- People exist **once**, in Lamaste. Applications do not create their own
  logins.
- An application's users are exactly the Lamaste users **entitled** to it.
  The application may keep a local user table — and should, for joins and
  history — but that table is a **projection** of Lamaste's directory, kept
  current by Lamaste, never edited as the source of truth.
- When a person or an entitlement changes, Lamaste **notifies** the
  application; the application pulls the change and applies it however suits
  its data. A periodic reconciliation catches anything a notification missed.
- On every request, the application knows **who** is calling, from an
  assertion it can verify — not from a header it has to take on faith.

PDKS is the case that shapes this: its screens show employees' names on every
row. It cannot ask Lamaste for each one; it keeps its own copy and needs that
copy to follow Lamaste.

## What exists today

| Piece | State |
|---|---|
| User store | Authelia's `users.yml`, keyed by **username**. No stable id. |
| `GET /api/identity/users`, `/users/:username`, `/groups` | Read `users.yml`; admin or agent with `identity:query`. |
| `GET /api/identity/self` | Echoes `Remote-*` headers; only meaningful behind Authelia. |
| SDK `IdentityClient` | `listUsers`, `getUser`, `listGroups` over mTLS. |
| SDK `parseIdentity` + Fastify plugin | Parses `Remote-User/Name/Email/Groups` headers. |
| Tunnel vhosts | **Blank** `Remote-User` and `Remote-Groups` before proxying — apps receive no identity. |
| Entitlements | Two models: per-plugin grants (`user-plugin-access.json`, by username) and Gatekeeper grants (groups → resources). |

So the SDK can list users, but nothing gives an application a stable key, a
scoped user list, a change feed, or a trustworthy identity on a request.

## Model

### Principals

Every user gets an immutable **`userId`** (UUID v4) at creation. Applications
key everything on `userId`; `username` is a mutable attribute (renames are
supported and propagate as an update).

The directory record Lamaste owns:

```ts
interface DirectoryUser {
  userId: string;            // UUID, never reused
  username: string;          // login name, unique, may change
  displayName: string;
  email: string;
  groups: string[];          // Lamaste groups (Gatekeeper tier), not raw Authelia groups
  status: 'active' | 'disabled';
  canSignIn: boolean;        // false = directory-only person (see "People who never sign in")
  updatedAt: string;
  version: number;           // per-record, increments on every change
}
```

Lamaste stores the directory in its SQLite state (`userId`, attributes,
version), and keeps `users.yml` as the **derived** credential file Authelia
reads — Lamaste writes it, never parses it as the source of truth.

### Entitlements

An **entitlement** says a user may use a plugin, optionally with roles:

```ts
interface Entitlement {
  plugin: string;            // "pdks", "apsiyon", …
  userId: string;
  roles: string[];           // plugin-declared roles, e.g. ["viewer"], ["manager"]
  source: 'direct' | `group:${string}`;
}
```

Entitlements are computed from Gatekeeper grants (user or group → plugin
resource, with roles as the grant's context). The older
`user-plugin-access.json` model is migrated into Gatekeeper grants, so there
is **one** entitlement model.

Plugins declare their roles in the manifest:

```jsonc
"identity": {
  "roles": [
    { "id": "viewer",  "label": "Görüntüleyici" },
    { "id": "manager", "label": "Yönetici" }
  ],
  "attributes": ["displayName", "email"]   // what the plugin is allowed to receive; default displayName only
}
```

`attributes` is data minimisation: a plugin receives only the fields it
declared, and the admin sees them at install.

### What a plugin sees

A plugin's directory view is its **audience**: the entitled users, each with
only the declared attributes and the plugin's roles.

```ts
interface AudienceMember {
  userId: string;
  username: string;
  displayName?: string;      // only if declared
  email?: string;            // only if declared
  roles: string[];           // this plugin's roles only
  status: 'active' | 'disabled';
  version: number;
}
```

Groups are not passed through raw — a plugin sees its roles, not the
organisation's group structure.

## Change feed

### Sequence

Every directory or entitlement change appends to a store-wide, monotonically
increasing **`seq`**, stamped in the same transaction as the change (the
pattern already proven in PDKS's sync: triggers stamp `seq`, a cursor on
`seq` also catches rewritten rows). The directory has a **`directoryId`**
that changes if the store is replaced, telling a subscriber its cursor is
void.

### Pull (the source of truth for subscribers)

```
GET /api/identity/audience?plugin=pdks                       → { directoryId, seq, members: [...] }   full snapshot
GET /api/identity/audience/changes?plugin=pdks&after=<seq>   → { directoryId, seq, changes: [...] }   since a cursor
```

Each change is the member's full new state or a tombstone:

```ts
type AudienceChange =
  | { seq: number; kind: 'upsert'; member: AudienceMember }
  | { seq: number; kind: 'remove'; userId: string; reason: 'deleted' | 'unentitled' };
```

Full state, not diffs, so a subscriber never has to reconstruct a record
from a chain of patches, and applying a change twice is harmless.
`changes` is paged (`limit`, default 500) and ordered by `seq`.

### Push (a nudge, not the data)

Pushing data to subscribers would make Lamaste responsible for delivery and
ordering to machines behind CGNAT. Instead Lamaste pushes a **notification**
and the subscriber pulls:

- **Agent-hosted app plugins:** the server half calls the agent half's
  `POST /admin/identity/notify { seq }` through the internal plugin tunnel
  (the channel from the app-plugin design). The agent half pulls
  `changes?after=<its cursor>`.
- **Server-hosted plugins:** an in-process event (`identity.changed`) on the
  plugin host.
- **Plain agents** (no app plugin): their 30-second sync already contacts the
  panel; the sync response carries the current `seq`, and the SDK pulls when
  it moved.

A lost notification costs nothing: the next one, the next sync, or the
reconciliation carries the cursor forward.

### Reconciliation

Daily, and at subscriber start-up, the SDK fetches the full audience snapshot
and compares it with the local projection (by `userId` and `version`). It
applies differences and logs how many it found — a non-zero count on a
healthy system is a bug in the change feed and is reported to the panel.

## SDK (`@lamalibre/lamaste-identity`)

Today's surface stays; three pieces are added.

### 1. `IdentitySubscriber` — keeps a local projection current

```ts
const subscriber = new IdentitySubscriber({
  plugin: 'pdks',
  client,                                  // existing IdentityClient (mTLS)
  cursorStore,                             // where the subscriber keeps { directoryId, seq }
  apply: async (changes, tx) => {          // the plugin decides what to do with each change
    for (const c of changes) {
      if (c.kind === 'upsert') upsertPerson(tx, c.member);
      else markRemoved(tx, c.userId, c.reason);
    }
  },
  reconcileEvery: '24h',
});
await subscriber.start();                  // initial snapshot or catch-up, then waits for notify()
subscriber.notify(seq);                    // called by the plugin's /admin/identity/notify route
```

Guarantees:

- `apply` receives changes in `seq` order, in batches; the cursor advances
  **only after `apply` resolves**, in the same transaction when the cursor
  store is the plugin's own database (SQLite helper provided).
- One pull at a time per subscriber; notifications during a pull coalesce.
- A changed `directoryId` triggers a full snapshot instead of a catch-up.
- Retries with backoff on 5xx and network errors; a 403 (plugin no longer
  allowed to query) stops the subscriber and reports it.

### 2. `verifyIdentity` — who is calling, provably

Requests reach applications with a **signed identity assertion** instead of
bare `Remote-*` headers:

- **Through the app-plugin forwarder:** the server half adds the caller to
  the caller assertion it already signs (app-plugin design, *Authentication
  between the halves*).
- **Through a plain tunnel** (`authenticated` / `restricted`): Gatekeeper,
  already the `auth_request` target, returns
  `X-Lamalibre-Identity: <JWT>` on allow; nginx copies it to the upstream
  request (`auth_request_set` + `proxy_set_header`) and still blanks every
  client-supplied `Remote-*` and `X-Lamalibre-Identity` header first.
  The JWT carries `sub` = `userId`, `username`, the declared attributes, the
  plugin's roles, `aud` = the tunnel's plugin or FQDN, and a 60 s lifetime.
  It is signed with a key Lamaste generates; applications verify it against
  Lamaste's published key set.

```ts
fastify.register(identityPlugin, { audience: 'pdks', keys: lamasteJwks });
// request.identity: { userId, username, displayName?, email?, roles } | null
```

Header parsing (`parseIdentity`) stays for compatibility but is documented as
**not** a trust mechanism.

### 3. Projection helpers

A small SQLite schema and helpers for the common case — a `lamaste_users`
table (`user_id PRIMARY KEY`, `username`, `display_name`, `email`, `roles`,
`status`, `version`, `removed_at`) plus the cursor row — so plugins that just
need names and roles do not each write their own. Plugins with their own
person model (PDKS) implement `apply` against their tables instead.

## Removal and history

Removing a user's entitlement or the user does **not** delete history in
applications:

- `remove` marks the local row `removed_at` and stops the person from using
  the application (their requests no longer carry an entitlement anyway).
- Historical rows keep pointing at the `userId`; the local row keeps the last
  known name so reports still read "Ayşe Yılmaz", not a UUID.
- Erasure (a person's right to have data deleted) is a separate, explicit
  operation: Lamaste emits `remove` with `reason: 'erased'`, and the
  application must anonymise its rows for that `userId`. Each plugin
  documents what erasure does to its data.

## Employees, badges and offboarding

Decided 2026-10-13: **employees are Lamaste users.** There is one directory
for everyone who works on the site; nobody exists only inside an application.
Ending a person's access to everything — signing in, GitLab, printing at the
portal, doors — is **one action in Lamaste**: disable the user (or remove an
entitlement to end one thing).

### Credentials a user holds

A user can hold several **credentials**, each of which proves "this is that
user" in a different place:

| Credential | Where it is presented | Verified by |
|---|---|---|
| Password + TOTP | Browser (Authelia) | Authelia |
| Badges (card ids) | Card readers at kiosks, the portal, doors | The site agent, from its local projection |
| Registry / API tokens | Terminals, machines | The service that issued them (e.g. Feria) |

Badges are managed in Lamaste on the user's page: enrol (scan or type the
id), label (e.g. "13.56 MHz", "125 kHz"), revoke. A person may hold several —
the taped 13.56 MHz + 125 kHz pair PDKS already handles is two badges on one
user. Badge ids are a user attribute plugins can declare (`"badges"`), so a
card-reading plugin receives them in its audience and nothing else does.

Disabling a user disables every credential at once. Revoking one badge (lost
card) leaves the others working.

### Actions authorised by a badge

A card scan becomes an authenticated, authorised request:

```
card read ─► site agent: badge id → userId (local projection)
           ─► is the user active? does the user hold the role for this action?
                 (e.g. pdks-portal: "print", doors: "door:main-gate")
           ─► allow / deny, locally
           ─► audit event { userId, badgeId, action, result, at } — kept locally,
              forwarded to Lamaste's audit log when online
```

- **Authorisation is a role on an entitlement**, exactly like the web: the
  portal plugin declares `print`, a door plugin declares one role per door or
  door group. Granting "can print" is a Gatekeeper grant; so is revoking it.
- **The decision is made on site**, from the agent's projection, so it works
  when the site's internet line is down (it has gone down before — see
  `herd/docs/site-network-architecture.md`).
- **Every action is logged with the user**, not the card: "printed 3 labels —
  Ayşe Yılmaz (badge 0006552424)". The badge id stays on the event because
  when a card misbehaves, the operator needs to know which one was presented.

### Revocation latency and offline sites

"One action ends everything" is only true once the change reaches each
place that enforces it:

| Enforcer | Reached by | Typical latency |
|---|---|---|
| Authelia (web sign-in) | Lamaste writes it directly | immediate |
| Tunnelled web apps | Gatekeeper, per request | immediate (within its cache lifetime) |
| Agent-hosted app plugins | Notify through the internal tunnel | seconds |
| Site agents (badges, doors) | Notify, else next 30 s sync | seconds; **unbounded while the site is offline** |
| GitLab | Connector (below) | seconds |

Offline sites are the hard case. A badge decision taken from a projection
that has not heard about a revocation will allow a dismissed employee in.
Each badge-reading plugin therefore declares an **offline policy**:

- `allow-cached` — keep deciding from the projection (printing, attendance:
  low harm, and refusing would block the whole site).
- `fail-closed-after: <duration>` — deny once the projection has not
  synchronised for longer than the duration (doors).

The agent reports projection age to the panel, so an offline site is visible.

### Card security

Badge ids are identifiers, not secrets. The 125 kHz EM cards in use are
trivially cloneable, and plain 13.56 MHz UID reads are copyable too. That is
acceptable for attendance and printing, where a cloned card is logged under
a real person. **It is not acceptable for doors.** Doors need cards that prove
possession cryptographically (e.g. MIFARE DESFire EV2/EV3 with keys held by
the reader), which is a reader and card change, not a software one. Until
then a door plugin should treat a badge as one factor and accept it only for
low-risk doors.

## Connectors: GitLab

GitLab is the first **connector** — a subscriber that projects the directory
into a system that has its own user database:

- **Sign-in:** GitLab signs users in through Lamaste's Authelia as an OpenID
  Connect provider (GitLab's OmniAuth `openid_connect`), the same OIDC
  provider the Feria design needs. Password sign-in on GitLab is turned off,
  so a GitLab account cannot outlive the Lamaste user.
- **Provisioning:** an `IdentitySubscriber` for the `gitlab` plugin's
  audience uses GitLab's admin API to create users (on first entitlement),
  update name and email, **block** on `remove` (blocking keeps their issues,
  comments and history intact), and unblock on re-entitlement. GitLab users
  are matched to Lamaste by `userId`, stored in GitLab as the OIDC identity's
  `extern_uid`.
- **Acting for a user from other applications:** a portal at a kiosk that
  lets a badged-in employee comment on or close an issue calls GitLab's API
  **as that user**, with an admin token and GitLab's `Sudo` header naming the
  user. That token is the most powerful credential in the setup: it lives
  only in the connector (an agent-hosted plugin), never on a kiosk; kiosks ask
  the connector, which checks the caller's identity assertion and the
  employee's entitlement before acting.

The same shape fits later systems: a door controller, a printer server, an
HR system — each is a subscriber with its own projection and its own idea of
"block".

**Feria** is one too. Its design (`feria/docs/design/networked-registry-and-login.md`)
asks Lamaste for a *group-change hook* that revokes or downgrades a person's
registry tokens when their `feria-*` membership changes. In this model that
hook is Feria's identity subscription: Feria declares the roles `reader`,
`publisher` and `admin`, entitlements grant them, and a `remove` or a role
change in Feria's audience triggers the revocation. One mechanism, not a
special hook per plugin.

## External systems of record

PDKS's roster is currently pushed by samplepark.tr's personnel system
(`HERD_PDKS_SYNC`, `PUT /kiosk/pdks/roster`). With a Lamaste directory, the
arrows have to be decided once:

- **Lamaste is the source:** samplepark pushes people into Lamaste's
  directory (a directory import API with the same full-snapshot semantics),
  and PDKS follows Lamaste.
- **The external system stays the source** and Lamaste mirrors it — same
  import API, run by a connector.

Either way PDKS stops being fed directly; there is one path into the
directory and one out of it.

## Security

- Directory queries require the plugin's own certificate and the
  `identity:query` capability **scoped to that plugin**: a plugin can read its
  audience, never the whole directory.
- A plugin receives only the attributes it declared, and the admin approves
  them at install.
- Identity assertions are signed (Ed25519), short-lived, audience-bound; the
  signing key is 0600, owned by the Lamaste service account; rotation keeps
  the previous key in the published set for one assertion lifetime.
- Client-supplied `Remote-*` and `X-Lamalibre-Identity` headers are always
  removed at the relay before any value is set.
- The change feed never carries credentials — no passwords, no TOTP data, no
  tokens.

## Lamaste changes required

| # | Change |
|---|---|
| 1 | Directory store in SQLite with `userId`, versions, `seq` triggers, `directoryId`; `users.yml` becomes derived. Migration assigns ids to existing users. |
| 2 | One entitlement model: migrate `user-plugin-access.json` into Gatekeeper grants with roles. |
| 3 | `identity` block in the plugin manifest (roles, attributes). |
| 4 | Audience snapshot and change-feed endpoints, scoped per plugin. |
| 5 | Notification fan-out: app-plugin forwarder, in-process event, `seq` in agent sync responses. |
| 6 | Identity assertions: signing key, JWKS endpoint, Gatekeeper returns the assertion, nginx forwards it. |
| 7 | Bulk user import (CSV) and a directory import API for external systems of record. |
| 8 | SDK: `IdentitySubscriber`, `verifyIdentity` plugin, SQLite projection helpers. |
| 9 | Badges as user credentials: enrol, label, revoke; `badges` attribute for card-reading plugins. |
| 10 | Audit log: events forwarded by plugins and agents (`userId`, credential, action, result). |
| 11 | Projection age reported by agents; offline policy declared by badge-reading plugins. |
| 12 | Authelia OIDC provider (shared with Feria) and a GitLab connector plugin. |

## Open questions

1. *(Decided 2026-10-13: employees are Lamaste users; badges are credentials on the user.)*
2. **PDKS's source of truth:** samplepark pushes into Lamaste, or Lamaste
   mirrors samplepark?
3. **Erasure:** which plugins hold data that must be anonymised on request,
   and is a single `erased` event enough for them?
4. **Door hardware:** which doors, and are their readers able to use
   cryptographic cards (DESFire)? Until then, doors stay out of scope.
5. **GitLab password sign-in:** turn it off once OIDC sign-in works (keeps
   offboarding single-action), with the root account as the only exception?
6. **Signing:** Gatekeeper signs assertions (it is already on the request
   path), or the panel issues them and Gatekeeper only forwards — which keeps
   Gatekeeper free of keys, as its design intends?
