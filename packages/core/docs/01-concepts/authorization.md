# Authorization (Gatekeeper)

> Gatekeeper is a lightweight Fastify service on `127.0.0.1:9294` that sits between Authelia (authentication) and tunnel backends, acting as an nginx `auth_request` target for fine-grained access control. Authelia determines WHO you are; Gatekeeper determines WHAT you can access.

## In Plain English

Lamaste already has a front door guard (Authelia) who checks your ID and lets you into the building. Gatekeeper is the hallway guard who checks whether you are allowed into a specific room.

Without Gatekeeper, every authenticated user can access every tunneled app. That is fine when all your users are trusted, but once you expose apps to different teams, clients, or the public, you need to control who sees what. Gatekeeper adds that control without replacing Authelia — the two work together.

When a visitor requests a tunneled app, nginx first asks Authelia "is this person logged in?" and then asks Gatekeeper "is this person allowed to access this specific tunnel?" Only if both answer yes does nginx proxy the request through.

There are three access modes for tunnels:

- **Public** — no authentication at all. nginx proxies directly to the backend.
- **Authenticated** — Authelia login required. Any authenticated user passes through.
- **Restricted** — Authelia login required, then Gatekeeper checks for a specific grant. If the user does not have one, they see a friendly 403 page with pre-filled message templates to request access.

## For Users

### Dual group system

Lamaste has two separate group systems that serve different purposes:

**Authelia groups** are identity-tier groups stored in `users.yml` and managed through the Users page. These are broad categories that describe who a user is:

| Group      | Purpose                                    |
| ---------- | ------------------------------------------ |
| `admins`   | Server administrators                      |
| `internal` | Internal team members                      |
| `external` | External collaborators, clients, or guests |

**Lamaste groups** are access-control groups stored in Gatekeeper's database (`gatekeeper.db`) and managed through the Gatekeeper dashboard. These are project-oriented groups that describe what a user can access:

| Example group  | Members           |
| -------------- | ----------------- |
| `developers`   | alice, bob        |
| `design-team`  | carol, dave       |
| `beta-testers` | alice, carol, eve |

The distinction matters because identity rarely maps cleanly to access. Alice might be an `internal` team member (Authelia group) who is on both the `developers` and `beta-testers` groups (Lamaste groups). Bob might be `external` but still in the `developers` group for a specific project.

Authelia groups are used for broad policy (e.g., all internal users can reach the intranet). Lamaste groups are used for fine-grained access control (e.g., only the design-team can reach the Figma proxy).

### Grants

Access is controlled through grants. A grant connects a principal (a user or a group) to a resource (a tunnel, a plugin, or any custom resource type).

For example:

- "User `alice` can access tunnel `staging-app`"
- "Group `developers` can access tunnel `api-docs`"
- "User `bob` can access plugin `herd`"

When a group is the principal, the grant expands to all members of that group at check time. If you add a new member to the `developers` group, they immediately gain access to everything granted to `developers` — no need to create individual grants.

Grants are not tunnel-specific. The resource model is generic: each grant has a resource type (e.g., `tunnel`, `plugin`) and a resource identifier. This means the same grant system works for tunnels, plugins, and any future resource types.

### Plugin roles (entitlements)

An agent-hosted plugin that declares `identity` has roles of its own — `viewer`, `editor`, whatever its manifest names. A grant on such a plugin (`resourceType: "plugin"`, `resourceId: <route>`) whose `context.roles` lists some of them is an **entitlement**: the user — or every member of the group — holds those roles in the plugin. The panel checks the roles against the plugin's manifest, keeps each plugin's **audience** (who holds which role) and sends it to the plugin's agent half, and on every request a user makes to the plugin's user surface tells the agent half who is calling, with which roles. A plugin grant without roles never makes anyone a plugin user. Manage entitlements from the plugin's **People** panel on the Plugins page, or `lamaste-server plugins entitlements` — see [Agent-Hosted Plugins](../04-api-reference/agent-hosted-plugins.md#users-and-identity).

### Who attests what

Gatekeeper authenticates the Authelia session; it does not tell applications who the user is. For a plain app tunnel nginx sets `Remote-User`, `Remote-Groups`, `Remote-Name` and `Remote-Email` from Gatekeeper's answer — replacing what the client sent, but **unsigned**: anything else that reaches the backend's loopback port can send them too. Signed identity exists in two places:

- **Plugin tunnels** (`type: 'plugin'`, into an agent's lamaste-agentd): Gatekeeper signs a relay assertion for the agent with the session's user ([Security Model](security-model.md#5c-the-agent-daemon-lamaste-agentd-and-relay-assertions)).
- **Plugin user surfaces** (`/api/<route>/app/*` on a host bound to an agent-hosted plugin): Gatekeeper **attests the session** — a relay assertion for the panel naming the username alone, bound to the method and the raw request path — and the **panel issues the identity** the application sees: the directory's `userId`, the username and the user's roles in the plugin, in the caller assertion it signs for the agent half ([Security Model](security-model.md#5f-users-of-agent-hosted-plugins-who-attests-what)).

### Access modes for tunnels

Each tunnel can be configured with one of three access modes:

**Public.** No authentication. nginx proxies requests directly to the backend without involving Authelia or Gatekeeper. Use this for public-facing services like a marketing site or a public API.

**Authenticated.** Authelia login required, but no grant check. Any user who can log in through Authelia can access the tunnel. Use this for internal services where everyone on the team should have access.

**Restricted.** Authelia login required, and Gatekeeper checks for a matching grant. If the user has a grant (directly or through a group), the request passes through. If not, the user sees a 403 access request page. Use this for sensitive services that only specific people or teams should reach.

### Access request pages

When a user hits a restricted tunnel without a grant, they do not see a generic "403 Forbidden" error. Instead, Gatekeeper returns a user-friendly HTML page that explains they do not have access and offers pre-filled message templates for requesting it:

- **Email** — a mailto link with a pre-filled subject and body addressed to the admin
- **Slack** — a copy-ready message formatted for Slack
- **Teams** — a copy-ready message formatted for Microsoft Teams
- **WhatsApp** — a copy-ready message formatted for WhatsApp
- **Generic** — a plain-text message suitable for any other channel

The templates include the user's name, the resource they tried to access, and a timestamp, so the admin receives all the context needed to create a grant.

### Managing groups and grants

From the Gatekeeper dashboard in the admin panel:

1. **Groups** — create Lamaste groups and add members (by Authelia username)
2. **Grants** — create grants connecting users or groups to resources
3. **Access Requests** — review incoming access requests from users who hit 403 pages
4. **Settings** — configure default access modes and other Gatekeeper behavior

### How changes take effect

Gatekeeper reads groups and grants from its SQLite database (`gatekeeper.db`) on every check, so a group, member or grant created through the admin panel takes effect on the next request — no service restart required. The tunnel list (the panel's `tunnels.json`) and Gatekeeper's settings (`gatekeeper.json`) are watched and reloaded when they change. Changes through the panel also recompute the audiences of agent-hosted plugins at once; edits made with Gatekeeper's own CLI are picked up by the panel within a minute.

### Domains and membership

On a relay with several domains, membership of a host's domain comes before every access mode: `authenticated` means "any signed-in member of this domain", and `restricted` still needs a grant on top. Membership is rendered into Authelia and checked again by Gatekeeper from the panel's `domains.json`; a signed-in non-member gets a "not a member of this domain" page — with the admin contact and a sign-out link — rather than the sign-in page. Members are managed per domain ([Domains API](../04-api-reference/domains.md)); the admin certificate manages every domain, and Authelia's `admins` group needs membership like everyone else (inside a domain it still passes `restricted` sites).

## For Developers

### Architecture

Gatekeeper runs as an independent Fastify service on `127.0.0.1:9294`. The vhost of every `authenticated` and `restricted` tunnel delegates each request to it with an nginx `auth_request` to `/authz/tunnel/<fqdn>` — the vhost names its tunnel in the path; Gatekeeper validates the Authelia session itself and decides.

The request flow for a restricted tunnel:

```
1. Visitor requests staging.example.com
2. nginx sends auth_request to Gatekeeper
   (127.0.0.1:9294/authz/tunnel/staging.example.com) with
   - X-Original-URL https://staging.example.com<request URI> and
     Host staging.example.com — the vhost's own hostname, from its configuration
   - X-Original-Method, X-Forwarded-For (the visitor's address, as nginx
     accepted it) and the visitor's Cookie header
3. Gatekeeper takes the tunnel named in the path (X-Original-URL and Host
   must agree), takes the visitor's authelia_session cookie — refusing a
   request with more than one — and validates it with Authelia for that
   URL, sending Authelia that cookie alone:
   a. No valid session -> 401 -> nginx redirects to
      auth.example.com/?rd=https://staging.example.com<request URI>
   b. Valid session -> the user (cached per session and host, see Session caching)
4. Gatekeeper checks for a matching grant:
   a. Grant exists (user or group match) -> 200 with Remote-User, Remote-Groups,
      Remote-Name and Remote-Email
   b. No grant -> 403 with access request HTML page (logged with the tunnel
      and the reason, never the username)
5. On 200 nginx proxies to the tunnel backend with those identity headers —
   and the visitor's cookies without authelia_session
```

The backend never receives Authelia's session cookie: nginx sets its `Cookie` from a map that removes every `authelia_session` pair, or sends none when it cannot ([nginx Configuration](../03-architecture/nginx-configuration.md#the-backend-cookie-map)). Gatekeeper's authorization routes are rate-limited per visitor address and tunnel host (6000 a minute each): nginx is their only caller and sets `X-Forwarded-For` to the visitor's address, which Gatekeeper trusts from `127.0.0.1` only, so one visitor exhausting its bucket leaves every other visitor theirs.

Public tunnel vhosts have no `auth_request`. For authenticated tunnels Gatekeeper answers 200 for any valid session without looking for a grant.

A tunnel bound as an agent-hosted plugin's user surface has a second subrequest for `/api/<route>/app*` — `/authz/user-surface/<fqdn>` — where Gatekeeper checks that the tunnel's agent hosts the plugin (it carries the plugin's internal tunnel, as `tunnels.json` records it), the session (and, on a restricted tunnel, the grant) as above, then answers with a single-use relay assertion for the panel instead of `Remote-*` headers, and a missing session with a JSON 401 instead of a login redirect ([Gatekeeper API](../04-api-reference/gatekeeper.md#user-surface-authorization-nginx-auth-request)).

### Which tunnel is authorized

Gatekeeper authorizes the tunnel the vhost names, never one the client names. nginx selects the vhost from the request line when a request is in absolute form (`GET https://staging.example.com/ HTTP/1.1`) and from `Host` otherwise, so a client can send the request line of one tunnel with the `Host` header of another. Vhosts written before 4.3 called `/authz/check` with `X-Original-URL` and `Host` built from the client's `Host` header (`$http_host`): an Authelia user allowed on any tunnel — and every user is allowed on an `authenticated` one — reached any `restricted` tunnel, app or plugin, by naming the allowed tunnel in `Host`, without a grant, and Authelia evaluated that other URL as well.

Generated vhosts now name their tunnel in the subrequest's path, `/authz/tunnel/<fqdn>`, as the agent-panel vhost names its agent, and write the same hostname into `X-Original-URL`, `Host` and the login redirect. Gatekeeper authorizes the tunnel in the path and refuses a check whose `X-Original-URL` or `Host` names another hostname, or has no `Host` (401), before asking Authelia. It refuses `/authz/check` outright (403): a vhost written before 4.3 that the panel has not rewritten closes its tunnel instead of opening it. The panel rewrites tunnel vhosts when it starts. Authelia-protected static sites, which ask Authelia directly, had the same flaw towards Authelia's per-site rules and are rewritten the same way; the auth portal's subrequest is rewritten too, as hardening. See [nginx Configuration](../03-architecture/nginx-configuration.md#authorization-subrequests-name-their-own-hostname).

### Grant model

The grant model is generic, not tunnel-specific:

```javascript
{
  grantId: 'g_abc123',           // unique identifier
  principalType: 'user',         // 'user' or 'group'
  principalId: 'alice',          // username or group name
  resourceType: 'tunnel',        // 'tunnel', 'plugin', or custom
  resourceId: 'staging-app',     // resource identifier
  context: {},                   // optional metadata; { roles: [...] } on a plugin entitlement
  used: false,                   // whether grant has been consumed
  createdAt: '2026-04-01T...',
  usedAt: null                   // consumption timestamp, or null
}
```

At authorization check time, Gatekeeper resolves the request in two steps:

1. **Direct match** — is there a grant where `principalType === 'user'` and `principalId` matches the `Remote-User` header?
2. **Group expansion** — for each Lamaste group the user belongs to, is there a grant where `principalType === 'group'` and `principalId` matches the group name?

If either step finds a matching grant for the requested resource, the check passes.

### Session caching

Authorization checks happen on every request to a restricted tunnel. A page load can trigger dozens or hundreds of subrequests (HTML, CSS, JS, images, API calls). Without caching, each subrequest would hit Authelia and Gatekeeper, creating unnecessary load.

Gatekeeper uses an in-memory session cache to solve this:

**Gatekeeper in-memory session cache.** When Gatekeeper receives a request, it extracts the user identity from the Authelia session. Validated sessions are cached in memory for 30 seconds (configurable via `sessionCacheTtlMs` in `gatekeeper.json`), keyed by the session cookie value **and the tunnel host** (an HMAC under a per-process key). Repeated Gatekeeper calls for the same session on the same host do not re-validate against Authelia; on another host they do — Authelia decides per host (a static site's or plugin tunnel's rules name users), so a session it accepted for one host proves nothing on another.

> **Note:** The installer also writes an nginx `proxy_cache_path` snippet (`/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf`) for optional nginx-level caching, but the generated vhosts do not currently include `proxy_cache` directives. All authorization caching relies on the Gatekeeper's in-memory session cache.

**Effect:** On a warm cache, repeated subrequests for the same session are resolved from the in-memory cache without re-validating against Authelia. Grants and groups are read on every check, so a revoked grant takes effect at once; the session itself — a user disabled or deleted in Authelia, a session that expired — is noticed within the 30-second TTL. (A plugin's user surface does not wait for it: the panel refuses a disabled or removed user on the next request.)

### State and change propagation

Groups, grants and the access-request log live in Gatekeeper's SQLite database, `/etc/lamalibre/lamaste/gatekeeper.db` (0600 with its WAL and SHM files; numbered migrations under `src/lib/migrations/gatekeeper/`). Every check reads it, and every write through Gatekeeper's API runs under the groups and grants locks and invalidates the session cache. Gatekeeper watches two JSON files with `fs.watch` (on their parent directory, since they are replaced by rename): the panel's `tunnels.json` — tunnels, access modes, plugin targets and user-surface bindings — and its own settings, `gatekeeper.json`.

The JSON files of earlier versions (`groups.json`, `access-grants.json`, `access-request-log.json`) are no longer read; the installer still creates empty `groups.json` and `access-grants.json`. The legacy `user-plugin-access.json` grants are not migrated into Gatekeeper (`migrateFromLegacy` exists but nothing calls it): they stay where the desktop's user-access flow reads them, and never make anyone a plugin user.

### Access request page generation

When Gatekeeper denies a request (no matching grant), it returns a 403 response with an HTML page instead of a bare status code. The page is generated from templates in `packages/lamaste-gatekeeper/src/lib/templates.ts` and includes:

- The username (from `Remote-User` header)
- The resource they attempted to access (the tunnel's hostname, from `X-Original-URL` — written by the vhost)
- A human-readable timestamp
- Pre-filled message templates for email (mailto link), Slack, Teams, WhatsApp, and a generic plain-text format

The HTML is self-contained (inline CSS, no external dependencies) so it renders correctly even when all other assets are blocked by the 403.

### State files

| File                                                        | Purpose                                                     | Format |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| `/etc/lamalibre/lamaste/gatekeeper.db`                      | Groups and members, grants, the access-request log          | SQLite |
| `/etc/lamalibre/lamaste/gatekeeper.json`                    | Settings                                                    | JSON   |
| `/etc/lamalibre/lamaste/gatekeeper-secret.json`             | The secret the panel calls Gatekeeper's management API with | JSON   |
| `/etc/lamalibre/lamaste/tunnels.json` (read only)           | The panel's tunnels and their user-surface bindings         | JSON   |
| `/etc/lamalibre/lamaste/relay-signing-key.json` (read only) | The relay signing key Gatekeeper signs assertions with      | JSON   |

### Source files

| File                                                               | Purpose                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `packages/sdks/gatekeeper/src/server/index.ts`                     | Fastify server setup, file watching                        |
| `packages/sdks/gatekeeper/src/server/routes/authz.ts`              | Tunnel and user-surface authorization (nginx auth_request) |
| `packages/sdks/gatekeeper/src/server/routes/grants.ts`             | Grant CRUD API                                             |
| `packages/sdks/gatekeeper/src/server/routes/groups.ts`             | Group CRUD API                                             |
| `packages/sdks/gatekeeper/src/server/routes/principals.ts`         | Removing a user principal everywhere                       |
| `packages/sdks/gatekeeper/src/server/routes/diagnostic.ts`         | Access check, settings, cache bust, access-request log     |
| `packages/sdks/gatekeeper/src/server/routes/access-request.ts`     | Access request submission and listing                      |
| `packages/sdks/gatekeeper/src/lib/authz.ts`                        | Authorization logic (grant matching, group expansion)      |
| `packages/sdks/gatekeeper/src/lib/state-db.ts`                     | `gatekeeper.db` and its migrations                         |
| `packages/sdks/gatekeeper/src/lib/grants.ts`, `groups.ts`          | Grant and group storage                                    |
| `packages/sdks/gatekeeper/src/lib/tunnels.ts`                      | What Gatekeeper reads of `tunnels.json`                    |
| `packages/sdks/gatekeeper/src/lib/templates.ts`                    | Access request HTML page generation                        |
| `packages/server/daemon/src/routes/management/gatekeeper-proxy.js` | Admin panel proxy to Gatekeeper API (role grants checked)  |
| `packages/server/daemon/src/lib/nginx.js`                          | Vhost generation with Gatekeeper auth_request blocks       |

## Quick Reference

### Service

| Property  | Value                                                                    |
| --------- | ------------------------------------------------------------------------ |
| Listen    | `127.0.0.1:9294`                                                         |
| Runtime   | Fastify (TypeScript)                                                     |
| State     | `gatekeeper.db` (SQLite), `gatekeeper.json` in `/etc/lamalibre/lamaste/` |
| RAM usage | Minimal (in-process)                                                     |

### Access modes

| Mode          | Authelia | Gatekeeper           | Who can access              |
| ------------- | -------- | -------------------- | --------------------------- |
| Public        | No       | No                   | Anyone on the internet      |
| Authenticated | Yes      | Yes (session only)   | Any logged-in Authelia user |
| Restricted    | Yes      | Yes (session, grant) | Users with a matching grant |

### Cache TTLs

| Layer                        | TTL | Key                                  |
| ---------------------------- | --- | ------------------------------------ |
| Gatekeeper in-memory session | 30s | Session cookie value and tunnel host |

### Group comparison

| Property    | Authelia groups                  | Lamaste groups                         |
| ----------- | -------------------------------- | -------------------------------------- |
| Purpose     | Identity classification          | Access control                         |
| Storage     | `users.yml`                      | `gatekeeper.db`                        |
| Managed by  | Authelia (via panel Users page)  | Gatekeeper (via panel Gatekeeper page) |
| Examples    | `admins`, `internal`, `external` | `developers`, `design-team`            |
| Granularity | Broad (who you are)              | Fine (what you access)                 |

### Related documentation

- [Authentication](authentication.md) — Authelia TOTP 2FA and the forward-auth pattern that Gatekeeper builds upon
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — auth_request configuration and vhost generation
- [Security Model](security-model.md) — authorization as part of defense-in-depth
- [Tunneling](tunneling.md) — tunnel types and access modes
