# Native Apps on the User Surface — Design Document

> **Status:** as planned, 2026-11-10; independently reviewed the same day — the review's findings are adopted in
> [Review (2026-11-10)](#review-2026-11-10), which amends the sections below where they differ. Implemented the same
> day on Lamaste `feat/native-app-signin` (waves 1–3, unit tests green) — [As implemented](#as-implemented-2026-11-10);
> reference [Native Apps](04-api-reference/native-apps.md). Proven on fresh VMs, rebased on 4.13.0 —
> [Rodeo (2026-11-10)](#rodeo-2026-11-10).
> **Release:** its own minor after 4.13.0 (calls between app plugins, trusted publisher scopes), unless ready in time.
> **Companions:** `identity-directory-design.md` (the directory, the audience, offboarding),
> `multi-domain-relay-design.md` (domains, owned groups, OIDC authorization policies),
> `plugin-development/design/agent-hosted-app-plugins.md` (slices 6 and 7: the user surface, web surfaces).

## Goal

A native (mobile) application signs a person in through the relay's identity and calls the
`/api/<route>/app/*` user-surface APIs of agent-hosted app plugins, with exactly the checks a
browser session gets, and with credentials that end when the person's standing ends.

Six requirements (from a product contract; generic):

1. **Bearer tokens on the user surface** — a JWT access token from the domain's issuer, issued to a
   native client of the host, with the host's audience, is admitted as a browser session is; the
   `Authorization` header never reaches the agent half.
2. **A native client per application**, registered by an administrator — public, PKCE `S256`,
   `authorization_code` + `refresh_token`/`offline_access`, claimed HTTPS redirect URIs, the
   audience of item 1, access tokens ≤ 15 minutes.
3. **Refresh tokens that end with the person's standing** — rotation, reuse revokes the grant,
   idle and absolute lifetimes per client (30 / 90 days), revocation on disable, removal, erasure,
   leaving the domain, losing every role on the client's plugins; grants listed per client and
   device, revocable.
4. **App association files** on the redirect host.
5. **One host for an application's user surfaces**, sites as well as tunnels, whichever agents
   host the plugins.
6. **Sign-in events** to plugins that declare they want them.

## Terms

| Term               | Meaning                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application host   | A user-surface host (core `UserSurfaceHost`): a tunnel bound to plugin routes, or a plugin-owned site. Everything an application needs lives on it: its plugins' `/api/<route>/app/*`, its shell, its sign-in. |
| Native client      | An OIDC public client Lamaste registers for one application host, at the administrator's request. One per host.                                                                                                |
| Audience of a host | `https://<fqdn>` — the host's origin. One audience per host, so one access token serves every plugin on it.                                                                                                    |
| Grant              | One person's sign-in on one device with one native client: the chain of refresh tokens from one authorization-code exchange. Lamaste's record, keyed by a grant id.                                            |
| Token broker       | The panel's handler of the domain's token and revocation endpoints (`auth.<domain>/api/oidc/token`, `/api/oidc/revocation`), in front of Authelia.                                                             |

## What Authelia 4.39.28 does — verified 2026-11-10

Checked against `authelia/authelia:4.39.28` in Docker with the client this design renders (a
script driving `/api/firstfactor`, `/api/oidc/authorization`, `/api/oidc/consent`,
`/api/oidc/token`, `/api/oidc/revocation` with `X-Forwarded-Proto/Host`):

| Fact                                                                                                                                                                                                                                                                           | Consequence                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| A public client with `require_pkce: true`, `pkce_challenge_method: S256` refuses an authorization request without a challenge and one with `plain` (`invalid_request` to the redirect URI).                                                                                    | PKCE S256 — **Authelia suffices.**                                  |
| `requested_audience_mode: implicit` with `audience: [https://<fqdn>]` puts the audience in every access token without the app asking for it.                                                                                                                                   | Audience — **Authelia suffices** (no `audience` parameter needed).  |
| `access_token_signed_response_alg: RS256` + a claims policy `access_token: [preferred_username]`: the access token is a JWT `typ: at+jwt`, `kid: lamaste-oidc`, with `iss`, `aud` (array), `client_id`, `jti`, `exp`/`iat`/`nbf`, `scp`, `sub` (opaque), `preferred_username`. | Offline verification by the issuer's JWKS — **Authelia suffices.**  |
| A per-client lifespan (`lifespans.custom.<n>`) sets access, ID and refresh token lifetimes; `expires_in` 899 for 15 minutes.                                                                                                                                                   | Access ≤ 15 min — **Authelia suffices.**                            |
| The refresh token rotates on every use; its lifetime restarts at each rotation (20 s lifespan: refreshed at 14/28/42 s, refused after 22 s idle). **There is no absolute lifetime.**                                                                                           | Idle — Authelia; **absolute — Lamaste.**                            |
| A spent refresh token is answered `invalid_grant`; the next use of its successor is answered **`500 server_error`** ("error revoking oauth2 access token session … no rows affected"). Revocation (RFC 7009) answers 200, the revoked token's next refresh `500`.              | Reuse detection exists but answers 500; **Lamaste owns the rules.** |
| A refresh after the user lost the group the client's authorization policy requires **succeeds**; after `disabled: true` it fails with 500; after deletion with `invalid_grant`.                                                                                                | Standing on refresh — **Lamaste.**                                  |
| `offline_access` makes Authelia ask for consent even in `consent_mode: implicit` ("explicit consent due to requirements requested by the client").                                                                                                                             | One consent screen per sign-in (rare for a phone app).              |
| No API revokes a user's tokens, lists grants per device, or emits sign-in events.                                                                                                                                                                                              | Grants, revocation, events — **Lamaste.**                           |
| Discovery (`/.well-known/openid-configuration`) names `https://auth.<domain>/api/oidc/token`, `/api/oidc/revocation`, `/jwks.json`; `code_challenge_methods_supported: [S256]`.                                                                                                | Apps use standard discovery; the broker sits on those exact paths.  |

## Design

### D1. Application hosts (requirement 5)

Today a route is served on at most one host (`userSurfaceHosts`: a route two hosts claim is served
on neither) and that stays: an application host is _the_ host of each of its routes, which is what
makes "one audience per host" and `Origin` checks well defined. What changes is which routes a
host may serve.

**Sites.** A plugin-owned site serves its owner's route and, new, the routes the administrator
**joins** to it: `SiteEntry.userSurface = { routes: string[] }` (≤ 15 more, `USER_SURFACE_MAX_ROUTES_PER_HOST`
in all). A joined route is served while its plugin is installed, approved, declares `identity`, is
hosted (by any agent) and no other host claims it — the rule a site's own route already follows.
The shell stays the owner's approved tree; the shell gate (`/authz/user-surface-shell/:fqdn`)
admits a user who is in the audience of **any** route the site serves (today: the owner's), plus
the site grant when restricted. API `PUT /api/plugins/:name/web-surface/routes/:route`,
`DELETE …/routes/:route` (admin), under the tunnel and sites locks; a joined plugin must be on the
site's domain (`plugins.domain`), like a tunnel binding. Uninstalling a joined plugin releases its
route (`releasePluginUserSurface`). A delegated invitation still names a plugin whose _own_ site it
is (unchanged).

**Tunnels.** A tunnel binds up to 16 routes, served only when the tunnel's agent hosts each plugin
— because the tunnel's agent serves the rest of the origin, and with a session cookie its pages
could call any served route as the visitor. New: the administrator may bind a route whose plugin
another agent hosts, **explicitly**: `PUT /api/tunnels/:id/user-surface { route, crossAgent: true }`
records `userSurface.originAgent = <the tunnel's agent now>`. A route is served when its plugin's
hosting agent is the tunnel's agent (as today) **or** the binding was made cross-agent and the
tunnel's agent is still `originAgent`. Reassigning the tunnel to another agent therefore stops the
cross-agent routes until an administrator binds again — the 4.5 protection against a silent change
of who serves the origin stays. Listings show `userSurfaceStatus` reason `cross_agent_unconfirmed`.

Everything that resolves a host already goes through core `userSurfaceHosts` (panel, Gatekeeper,
vhost renderer), so the rule changes in one place: `tunnelServedUserSurfaceRoutes` and the site
branch. The site vhost renders the user-surface locations of every served route.

### D2. Native clients (requirement 2)

Registered in the panel's `state.db` (migration `0023_native_apps.sql`, after slice 8's `0022`):

```
native_clients(
  client_id TEXT PRIMARY KEY,          -- lamaste-native-<slug>
  host_kind TEXT, host_id TEXT,        -- 'site' | 'tunnel', the entry's id; UNIQUE(host_kind, host_id)
  name TEXT,                           -- shown on Authelia's consent screen
  redirect_paths_json TEXT,            -- 1–4 paths on the host
  access_token_minutes INTEGER,        -- 5–15, default 15
  idle_days INTEGER, absolute_days INTEGER,  -- 1–365, defaults 30 / 90, idle ≤ absolute
  associations_json TEXT,              -- D6
  enabled INTEGER, created_at, updated_at, version)
```

- **Id** `lamaste-native-<slug>` (`slug` `[a-z0-9-]{1,40}`, chosen by the administrator). The
  `lamaste-` prefix becomes Lamaste's: a manifest's `oidcClients` id `lamaste` or `lamaste-*` is
  refused (today only the panel's own `lamaste-server` lives there, and a plugin routed `lamaste`
  could have collided with it).
- **Host**: one native client per application host. The host's fqdn is derived on every read
  (the site's or tunnel's `fqdn`), never stored twice; so is its domain (`domainOfHost`). Deleting
  the host deletes the client (and revokes its grants, D4); a tunnel or site whose fqdn changes is
  a new host to the client (sites and tunnels do not rename today — asserted).
- **Redirect URIs** `https://<fqdn><path>`: each path `^/[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*$`, ≤ 128,
  no dot segments, not under `/api/` or `/.well-known/`, no query or fragment. Claimed by the app
  (D6); the host serves a fallback page there (D6).
- **Authelia rendering** (core `renderNativeClient`, beside `renderOidcClient`; the section is
  assembled by `buildOidcProviderSection`, which gains `nativeClients`):
  `public: true`, `token_endpoint_auth_method: none`, `require_pkce: true`,
  `pkce_challenge_method: S256`, `grant_types: [authorization_code, refresh_token]`,
  `response_types: [code]`, `scopes: [openid, offline_access, profile]`,
  `access_token_signed_response_alg: RS256`, `requested_audience_mode: implicit`,
  `audience: [https://<fqdn>]`, `claims_policy: <id>` (`access_token: [preferred_username]`),
  `consent_mode: explicit`, `lifespan: <id>` with `lifespans.custom.<id>`:
  `{ access_token: <m> minutes, id_token: <m> minutes, refresh_token: <idle> days }`,
  `redirect_uris`, `authorization_policy: lamaste_client_<id>`.
- **Who may sign in** (`authorization_policies.lamaste_client_<id>`, rendered with the other
  clients' policies under the domain rendering lock): the members of the host's domain, and the
  external members granted the host — the owned host group `<fqdn>` that already exists for
  external members granted a restricted tunnel or surface (`group:lamaste:x:<key>` AND
  `group:<fqdn>`). Authelia applies it on every authorization request; on refresh it does not
  (verified) — the broker does (D4).
- **A disabled client** is removed from Authelia's configuration (no new sign-ins) and its grants
  are refused by the broker; enabling renders it again. Deleting revokes every grant.
- Changes restart Authelia (a structural change, as for plugin OIDC clients — `syncOidcClients`
  re-renders the whole section; native clients join `planOidcClients`' inputs).

API (admin certificate): `GET /api/native-apps`, `POST /api/native-apps`, `GET|PATCH|DELETE
/api/native-apps/:clientId`, grants under D4. `native-apps` joins `RESERVED_API_PREFIXES`. Audit
`native-app.created|updated|deleted|enabled|disabled`.

### D3. Bearer tokens on the user surface (requirement 1)

**nginx.** The user-surface locations' Gatekeeper subrequest (`gatekeeperSubrequest`) additionally
passes `Authorization $http_authorization` — to Gatekeeper only; the proxied request to the panel
already clears `Authorization` (`USER_SURFACE_PROXY_HEADERS`) and the panel's forwarder strips
credentials, so the header never reaches an agent half (asserted by tests at both layers).

**Gatekeeper** (`/authz/user-surface/:fqdn`). When the request carries `Authorization`:

1. It must be exactly `Bearer <compact JWS>` (≤ 8 KiB); anything else → 401.
2. The token is authenticated **instead of** the session: a cookie that comes with it is ignored
   (a native HTTP stack may share a cookie jar with a web view; a browser never attaches a bearer
   token by itself, so the bearer is the request's only credential).
3. Verification (core `verifyNativeAccessToken`, pure, `node:crypto`): header `alg: RS256`,
   `typ: at+jwt`, a `kid` in the issuer's key set; signature; `iss === https://auth.<domain of the
host>`; `aud` (string or array) contains `https://<fqdn>`; `client_id` is the host's native
   client in the panel's projection `native-apps.json` (0600, `{ v: 1, clients: [{ clientId,
fqdn, enabled }] }`, rewritten under the domain rendering lock; Gatekeeper watches it as it
   watches `domains.json`; missing or unreadable → every bearer refused); `exp > now`, `nbf`/`iat ≤
now + 30 s`, `exp − iat ≤ 15 min + 30 s`; `jti` a UUID; `preferred_username` a Lamaste
   username. The key set comes from Authelia (`http://127.0.0.1:9091/jwks.json`, forwarded host of
   the domain's portal), cached; refetched on an unknown `kid` at most every 30 s.
4. Then exactly the session path's checks: domain membership from the projection (member, or
   external member with `externalRefused` rules), the host grant on a restricted host, the route
   served on this host.
5. It signs the relay assertion for the panel as for a session, with one addition to the panel
   user caller: `credential: { kind: 'bearer', clientId, jti, exp }` (core `relay-assertion.ts`
   panel form; absent = session). Never logged (the `jti` is a key to a live token).

A bearer that fails → 401 (nginx → `/authz/user-surface-unauthenticated`, JSON `{ error:
'unauthenticated' }` plus `WWW-Authenticate: Bearer error="invalid_token"`) so the app refreshes;
a refusal of the person → 403 as for a session.

**Panel** (`userSurfacePlugin`, `lib/user-surface.js`, `lib/user-caller.js`):

- `verifyUserSurfaceRelay` returns the credential.
- **The token must be live** (`lib/native-grants.js` `liveAccessToken(jti, clientId)`): its `jti`
  is recorded for a grant that is not revoked, of this client, whose user is the attested
  username's directory user — an **allow-list** filled only by the token broker (D4). An access
  token Lamaste did not see issued — minted by anyone reaching Authelia's token endpoint other than
  through the broker — is refused, and revoking a grant ends its access tokens at once instead of
  after 15 minutes.
- `resolveUserCaller` is unchanged: user active, no pending principal cleanup, active audience
  member with a declared role, plugin ready. The agent half receives the same `{ type: 'user',
userId, username, roles }` caller.
- **`Origin`.** A request that may change something must today carry the bound host's `Origin`
  (CSRF: a cookie travels with any cross-site request). A native HTTP stack sends no `Origin`, so
  that rule would refuse every native POST — it is waived when the credential is a bearer token,
  which no browser attaches on its own. `Sec-Fetch-Site`/`Sec-Fetch-Dest` rules stay as they are
  (a native client sends neither).
- The open-response sweep also ends a bearer request's response when its grant is revoked
  (`grant_revoked`).

### D4. The token broker, grants and revocation (requirement 3)

**Why a broker.** Authelia has no absolute lifetime, does not check standing on refresh, answers a
detected reuse with `500`, and offers no way to revoke a user's tokens or list them per device. All
four need Lamaste on the refresh path. Lamaste does not reimplement OAuth: Authelia stays the
issuer; the broker decides whether a request reaches it and records what it answered.

**nginx** (every auth vhost): `location = /api/oidc/token` and `location = /api/oidc/revocation`
→ `http://127.0.0.1:3100/api/native-apps/oauth/token|revocation`, `Host auth.<domain>` written
literally, `X-Forwarded-Host` cleared, `client_max_body_size 16k`, the client address as for the
invitation API. Everything else stays on Authelia.

**Panel** (`routes/native-oauth.js`, registered on the root instance like the user surface — no
mTLS, no 2FA; 503 before onboarding; own rate limit 120/min per IP + 30/min per refresh-token hash):

- Reads the form body (`application/x-www-form-urlencoded`, ≤ 16 KiB, each parameter once). The
  domain is the one whose portal the raw `Host` names.
- **Not a native client of that domain** (`client_id` absent from the body, or another client's):
  the request is passed to Authelia **unchanged** — same body bytes, `Content-Type`, `Accept`,
  `Authorization` (confidential clients' basic auth), `X-Forwarded-Proto: https`,
  `X-Forwarded-Host: auth.<domain>`, `X-Forwarded-For` — and Authelia's answer returned unchanged
  (status, `Content-Type`, `Cache-Control`, `Pragma`, body). Nothing logged but metadata.
- **`grant_type=authorization_code`** for a native client: forwarded (without Lamaste's own
  `device_name` parameter, see below). On 200 the broker decodes the access token it was just
  given (iss/aud/client checked as in D3 — it came from loopback, but a misrendered client must not
  produce a grant), resolves `preferred_username` to the directory user and checks **standing**
  (below). Standing fails → the refresh token is revoked at Authelia at once (RFC 7009 on loopback;
  the broker holds it now) and the app gets `400 invalid_grant`. Otherwise it creates the grant and
  records the refresh token's SHA-256 and the access token's `jti`, then returns Authelia's answer.
  A sign-in event is queued (D7).
- **`grant_type=refresh_token`** for a native client, under the grant's lock:
  - the token's SHA-256 is the grant's **current** token → checks: client enabled, grant not
    revoked, idle (`last_used_at + idle_days`) and absolute (`created_at + absolute_days`) not
    passed, standing. Any failure revokes the grant (reason `idle_expired`, `absolute_expired`,
    `standing:<why>`, `client_disabled`) and answers `invalid_grant`. Otherwise forwarded; on 200
    the old hash moves to the grant's spent set, the new one becomes current, the new `jti` is
    recorded, `last_used_at` set. On Authelia `400 invalid_grant` the grant is revoked
    (`issuer_refused`). On 5xx or a timeout the grant stays as it was and the app gets `503`
    (whether Authelia rotated is unknown: the next attempt with the same token is forwarded again;
    if Authelia had rotated, it refuses and the grant ends — the cost of a lost answer, as in any
    rotating scheme).
  - the hash is a **spent** token of a grant → **reuse**: the grant is revoked (`reuse`), its
    access tokens dropped, audited `native-app.grant.reuse-detected` and admins notified; the
    answer is `invalid_grant`. Concurrent refreshes with one token are serialized by the grant's
    lock, so the second is a reuse too — apps must refresh one at a time (documented).
  - unknown hash → `invalid_grant`, never forwarded.
- **Other grant types** for a native client → `400 unsupported_grant_type` (never forwarded).
- **Revocation** for a native client: the grant whose current or spent token matches is revoked
  (`revoked_by_client`); the request is forwarded to Authelia too; the answer is always `200`
  (RFC 7009 §2.2).
- **Device.** The authorization-code exchange may carry `device_name` (≤ 64 printable characters;
  removed before forwarding); the grant also keeps a coarse `User-Agent` summary (≤ 128, control
  characters stripped). Nothing else about the device is stored.

**Standing** (`nativeStanding(grant | user, client)`): the directory user is `active` and has no
pending principal cleanup; it is a member of the host's domain, or an external member granted the
host (the host group, read as the rendering reads grants); on a restricted host it holds the
host's grant (Gatekeeper `principals/user/inspect`, the call delegated invitations use — fail
closed: Gatekeeper unreachable answers 503 on refresh and never revokes); and it is an active
member of the audience of at least one route the host serves (roles ∩ declared).

**State** (`0023`):

```
native_grants(grant_id TEXT PK, client_id, user_id, created_at, last_used_at,
              absolute_expires_at, device_name, user_agent, revoked_at, revoked_reason, version)
native_refresh_tokens(sha256 TEXT PK, grant_id, state 'current'|'spent', issued_at)
native_access_tokens(jti TEXT PK, grant_id, expires_at)
```

Only hashes and `jti`s — never a token. Spent rows are deleted when their grant ends or expires;
access-token rows once expired (minute tick). A grant's rows go 30 days after it ended (the audit
log keeps the history).

**Revocation outside a request** (`revokeNativeGrants({ userId? , clientId?, grantId? }, reason)`):
one transaction marks the grants revoked and deletes their `current` token and access-token rows;
open responses of those grants are ended by the next sweep. Called from:

| Event                                                      | Where                                                                      |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| user disabled or removed (API or adopted from `users.yml`) | `offboardUserUnlocked` — the one offboarding function                      |
| user erased                                                | `eraseDirectoryUser` (also deletes the user's ended grants and events)     |
| user leaves a domain (membership deleted, kind changed)    | `lib/domains.js` membership changes — grants of that domain's clients      |
| audience recomputed (roles changed, grant revoked, …)      | after each recompute: grants whose user no longer has standing (cheap SQL) |
| host grant revoked on a restricted host                    | the Gatekeeper proxy's grant revocation path, then the standing check      |
| client disabled / deleted, host deleted, route set changed | `lib/native-apps.js`                                                       |
| an administrator revokes a grant                           | `DELETE /api/native-apps/:clientId/grants/:grantId`                        |

A minute tick also runs the standing check over every live grant, so a change Lamaste did not see
(an edit of `users.yml` adopted by the reconcile, a Gatekeeper outage that ended) still ends grants
within a minute. Each revocation is audited `native-app.grant.revoked` with the reason and ids only.

**Authelia's own tokens** of a revoked grant are not revoked there (the broker holds only hashes).
They are unreachable: the token endpoint for a native client is the broker, and an access token
minted by reaching Authelia some other way (a process on the relay's loopback) is not on the
allow-list (D3). Authelia's refresh lifetime is the client's idle lifetime, so they also expire.

**Listing**: `GET /api/native-apps/:clientId/grants?userId=&status=live|ended` (id, user id and
username, device name, user agent summary, created, last used, expires, revoked reason);
`GET /api/users/:username/native-grants`; `DELETE …/grants/:grantId`; `POST
/api/native-apps/:clientId/grants/revoke {userId}` (all of a user's). A person revokes their own
device by signing out (the app calls the revocation endpoint).

### D5. Where Authelia suffices, where Lamaste adds

| Need                                                | Authelia                   | Lamaste                                          |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------ |
| Sign-in, second factor, consent                     | yes                        | —                                                |
| Public client, PKCE S256, claimed redirect URIs     | yes (rendered config)      | validates paths, renders                         |
| JWT access tokens, audience, ≤ 15 min               | yes                        | verifies (Gatekeeper), allow-lists `jti` (panel) |
| Who may sign in (domain, externals)                 | yes, at authorization only | standing on every refresh and every request      |
| Rotation                                            | yes                        | tracks the chain (hashes)                        |
| Reuse ⇒ revoke the grant                            | partly (answers 500)       | detects reuse itself, revokes, audits, notifies  |
| Idle lifetime                                       | yes (per-client lifespan)  | enforces it too (its clock decides first)        |
| Absolute lifetime                                   | **no**                     | yes                                              |
| Revoke on disable / remove / erase / domain / roles | **no** (disable → 500)     | yes                                              |
| List / revoke per device                            | **no**                     | yes                                              |
| App association files                               | no                         | yes (D6)                                         |
| Sign-in events                                      | no                         | yes, for native sign-ins (D7)                    |

### D6. App association files and the redirect path (requirement 4)

**Setting** (`native_clients.associations_json`, validated in core `NativeAssociationsSchema`):

```json
{
  "ios": { "teamId": "ABCDE12345", "bundleIds": ["com.example.app"] },
  "android": [{ "packageName": "com.example.app", "sha256CertFingerprints": ["AA:BB:…:FF"] }]
}
```

`teamId` `^[A-Z0-9]{10}$`; bundle ids and package names reverse-DNS (`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)+$`, ≤ 155); fingerprints 32 colon-separated upper-case hex pairs; ≤ 10 of each.

**Rendered files** (core `renderAppleAppSiteAssociation`, `renderAssetLinks`, pure):

- `apple-app-site-association`: `applinks.details[{ appIDs: ["<team>.<bundle>"…], components: [{ "/": "<redirect path>" }…] }]`
  and `webcredentials.apps`. Only the **redirect paths** are claimed — never the whole host, so the
  shell's own links keep opening in the browser.
- `assetlinks.json`: `delegate_permission/common.handle_all_urls` per package (Android filters
  paths in the app's own manifest).

Written by the panel to `/var/www/lamaste/native/<fqdn>/` (`lamaste:www-data`, as the web root),
atomically, whenever the client changes; removed with it.

**The host's vhost** (site and tunnel renderers, through `lamaste-priv` — `alias`, `default_type`,
`add_header` are already allowed) gains, before any authorization:

- `location = /.well-known/apple-app-site-association` and `location = /.well-known/assetlinks.json`:
  `auth_request off`, `alias` the file, `default_type application/json`, `Cache-Control: max-age=300`.
- `location = <redirect path>` for each path: `auth_request off`, `access_log off` (the query holds
  an authorization code — useless without the app's PKCE verifier, but not for a log), a static
  Lamaste page (`renderNativeRedirectPage`, the domain's language and brand, no script: "Open this
  in the app; if nothing happens, the app is not installed"), `Referrer-Policy: no-referrer`,
  `Cache-Control: no-store`, CSP `default-src 'none'; style-src 'sha256-…'`.

`lamaste-priv`'s allow-list gains `access_log off` in a location (the only form). A tunnel host's
agent no longer answers those exact paths — the administrator chose them for the app.

### D7. Sign-in events (requirement 6)

**Manifest**: `identity.signInEvents: true` (core `IdentityBlockSchema`; only with an agent half).
In the approval digest only when true (absent/false normalised away, so every existing digest is
unchanged); an update that turns it on is `identity.changed` (new data reaches the plugin), never
auto-approved; `identityDiff` reports `signInEventsAdded|Removed`.

**What is a sign-in.** A native grant created by an authorization-code exchange (D4): `{ userId,
at, client: { kind: 'native', clientId } }`. A browser sign-in is **not** an event: Authelia
signs people in on `auth.<domain>` and tells Lamaste nothing, and "the first request of an
unfamiliar session on a host" is a guess, not a sign-in. Directories keep reporting a browser
user's last activity (open question Q1).

**Delivery.** Each event is queued (`native_sign_in_events(seq, plugin, user_id, at, client_id,
delivered_at)`) for every plugin the client's host serves that declares `signInEvents`, approved,
whose audience holds the user as an active member at that moment. A per-plugin loop
(`lib/sign-in-events.js`, beside `identity-sync.js`, same preconditions: hosting active and not
down) sends `POST /admin/identity/sign-ins { protocol: 1, events }` with the events sealed as
identity changes are (core `sealIdentityChanges`' construction, its own info string), ≤ 200 per
batch, oldest first; the half answers `{ acknowledged: <last seq> }`. Retries back off to 10
minutes; events older than 7 days are dropped undelivered (counted in an audit line). Erasure
deletes the user's queued events. Agent side: `createSignInEventsHandler({ verifier, onEvents })`
in `@lamalibre/lamaste/agent` (caller `lamaste`, body hash required); the forwarder already
reserves `/admin/identity*`.

### D8. Panel, CLI, desktop

- **Panel**: a **Native apps** page — per application host: the client (id, name, redirect paths,
  lifetimes, enabled), the iOS and Android associations with the URLs of the served files, the
  grants (person, device, last used, expires, revoke; filter by person); the plugin card's Web
  surface section gains **Joined plugins**; the Tunnels user-surface dialog gains the cross-agent
  confirmation; Users → a person's devices.
- **CLI** `lamaste-server native-apps list|create|update|delete|enable|disable|grants|revoke`,
  `plugins web-surface <name> join|leave <route>`, `tunnels bind-user-surface … --cross-agent`.
- **AdminClient** (core types) `listNativeApps|createNativeApp|updateNativeApp|deleteNativeApp|
listNativeGrants|revokeNativeGrant|revokeUserNativeGrants|joinWebSurfaceRoute|leaveWebSurfaceRoute`
  — web (`apiFetch`) and desktop (`admin_*` Tauri commands via `curl_panel`).

## Security notes

- **Bearer only on the user surface.** Nothing else on the relay accepts these tokens: the panel's
  management API stays mTLS. On a host with a native client no location passes `Authorization`
  to a backend, and every bound route — served or not — is answered by the relay (R2).
- **The allow-list** makes Lamaste the only way to a usable access token for a native client, and
  makes revocation immediate.
- **Hashes only.** Refresh tokens (≥ 256 bits from Authelia) are stored as SHA-256; access tokens
  by `jti`. A database read gives no usable credential.
- **No new trust in the agent half.** It receives the same signed `user` caller; it never sees the
  token, the client or the grant (only, if declared, the sign-in event's client id).
- **Token endpoint availability.** All token traffic of a domain — plugins' clients included —
  passes through the panel. The pass-through is byte-for-byte and bounded (16 KiB, 10 s); a panel
  restart briefly delays plugin sign-ins (the panel restarts in seconds). The registry broker's own
  `client_credentials` call goes to Authelia directly on loopback (unchanged).
- **Cross-agent bindings** widen who serves an origin that reaches a plugin's users; they need an
  explicit administrator action and lapse when the tunnel changes agent.
- **Redirect paths** are served without authentication on purpose (the OS hands them to the app;
  the fallback page shows nothing of the request) and are kept out of the access log.

## Proof (rodeo, fresh VMs)

Three-VM (relay, agent hosting two app plugins, visitor), new specs on a shared harness:

- **A — sign-in and calls:** a native client on a plugin-owned site that joins a second plugin
  hosted by the other agent's half (D1); PKCE sign-in driven from the visitor (first factor, TOTP,
  consent, code); the token's claims; a bearer `GET` and `POST` (no `Origin`) to both plugins'
  `/app/*`, the half seeing the `user` caller and no `Authorization`; a cookie beside the bearer
  ignored; a wrong audience, another host's client, an expired or tampered token → 401; the
  association files and the fallback page served without a session; `plain`/missing PKCE refused.
- **B — refresh:** rotation; reuse of a spent token revokes the grant (its live access token
  refused at once, its current refresh token refused); idle and absolute lifetimes (a client with
  1-day lifetimes and the relay clock moved, or a test-only lifespan override — decided in the
  harness); listing per device; revocation by the admin and by the app.
- **C — standing:** revocation on disable, on removal, on erasure, on leaving the domain, on losing
  the last role (grant revoked in Gatekeeper → the minute tick or the recompute ends it); a refresh
  after each refused; a sign-in event delivered to a plugin that declares it and not to one that
  does not; a tunnel binding across agents (made, served, lapses on reassignment).

Single-VM: validation of the client API and the associations, the rendered Authelia section, the
vhosts through `lamaste-priv`, the pass-through of a plugin client's device-code flow through the
broker, the CLI. The suites' existing user-surface, web-surface and OIDC specs (26, 27, 32, 40, 57)
as regressions.

## Waves

1. **Core**: native client schema and rendering, association files, the access-token verifier,
   relay-assertion credential, `userSurfaceHosts` rule changes, manifest `signInEvents`, the
   reserved id prefix; unit tests.
2. **serverd + Gatekeeper + nginx**: migration `0023`, `lib/native-apps.js`, `lib/native-grants.js`,
   the broker, the bearer path, joined routes and cross-agent bindings, revocation hooks, sign-in
   events, the vhosts and `lamaste-priv`; unit tests.
3. **Panel UI, CLI, desktop, agent-side handler, docs** (API reference, concepts, CLAUDE.md,
   CHANGELOG).
4. **Rodeo** specs and the campaign on fresh VMs (the shared three-VM set is scheduled by the
   coordinating session).

## Review (2026-11-10)

An independent reviewer read the design against the code and ran further experiments on Authelia
4.39.28 (`review-authelia/t.mjs`, `t7.mjs`): Authelia accepts a public client's token requests with
`Authorization: Basic base64("<id>:")` and no `client_id` in the body; it binds the issuer
between authorization, code exchange and refresh (a refresh at another domain's portal is refused
without consuming the token); `/api/oidc/token/` answers 308 to the canonical path; an access token
not on Lamaste's allow-list is still accepted by Authelia's `/api/oidc/userinfo`. Adopted:

- **R1 (broker classification, H1).** A token or revocation request is native when its body
  `client_id` **or** its Basic username (form-urlencoded-decoded, as Authelia decodes it) names a
  native client (`lamaste-native-*`), or when its `refresh_token`/`token` hashes to any known
  current or spent token — whatever the client fields say. Body id and Basic username that differ →
  `400 invalid_request`. A native request with an `Authorization` header is refused (`invalid_client`:
  native clients are public). Unknown `lamaste-native-*` ids are never passed through.
- **R2 (no bearer reaches an agent, H2).** Every _bound_ route of a host gets relay-answered
  locations (`/api/<route>/app`, `/api/<route>/app/`): served → the user-surface path; not served →
  `503` JSON from nginx, never the tunnel's agent. On a host with a native client every location
  proxying to a backend clears `Authorization`.
- **R3 (cross-agent lapse, H3).** `originAgent` is cleared whenever the tunnel's `agentLabel`
  changes or is dropped (`releaseAgentTunnels`, `assignTunnelLocked`), so a re-enrolled label never
  revives a binding.
- **R4 (factor, H4).** A native client's authorization policy uses the factor the domain's
  `access_control` applies to its hosts' members — `two_factor` in the current rendering
  (`authelia.ts` host rules) — never weaker; rendered by the same function.
- **R5 (foreign domains, H5).** The broker refuses a `lamaste-native-*` id that is not a client of
  the portal's own domain (`invalid_client`), so a code obtained at another domain's portal can be
  exchanged nowhere (the issuer binding refuses it at its own portal).
- **R6 (keys, H6).** Gatekeeper refetches the JWKS on an unknown `kid` **or** a signature failure
  (at most every 30 s), and answers `503` (not `401`) while it holds no keys, so apps do not discard
  tokens during an Authelia outage.
- **R7 (commit races, C1).** The broker commits a rotation with compare-and-swap (`revoked_at IS
NULL AND version = v`); if it loses (revoked meanwhile), it revokes the new refresh token at
  Authelia on loopback (held in memory at that moment) and answers `invalid_grant`. The code exchange
  re-checks the directory part of standing inside the grant's insert transaction.
- **R8 (lost answers, C2).** A **grace window of 30 s**: after a rotation the broker keeps Authelia's
  answer encrypted (AES-256-GCM, key HKDF-SHA256 of the _old_ refresh token, so the database alone
  yields nothing usable) and returns it again for the old token within the window, if the grant is
  still live. A spent token presented after the window is reuse. Concurrent refreshes within the
  window therefore get the same answer instead of revoking the grant.
- **R9 (5xx, C3).** Three consecutive Authelia 5xx for a grant's current token while Authelia's
  discovery answers (so Authelia is up) revoke the grant (`issuer_refused`); 5xx while Authelia is
  down answer `503` and keep the grant.
- **R10 (expiry on requests, C4).** `liveAccessToken` also refuses a grant past its absolute or idle
  expiry.
- **R11 (the 401, C5).** Gatekeeper already receives `Authorization` (nginx passes request headers;
  the subrequest does not clear it) — no nginx change is needed there. A refused bearer gets `401` with
  `X-Lamalibre-Refusal: invalid_token`, which the user-surface 401 location turns into
  `{ error: 'invalid_token' }` and `WWW-Authenticate: Bearer error="invalid_token"` (proved on the
  VMs; nginx keeps `auth_request_set` variables on a 401). The panel answers a token not on the
  allow-list `401 { error: 'invalid_token' }` with the same header.
- **R12 (inactive domains, C6).** Native clients of a domain that is not active are left out of the
  rendering, as plugin clients are; they are listed with `served: false`.
- **R13 (cost, C7).** The standing tick batches Gatekeeper inspections per host (one call per user per
  restricted host per tick, at most once a minute); the recompute hook checks the directory and
  audience parts in SQL and leaves the restricted-host grant to the tick.
- **R14 (locks, C8).** Order: tunnel → sites → users → domain rendering (`renderMutex`) and
  entitlements → invitations → **native grants** (a leaf: per-grant mutex and the `native_*` tables;
  nothing is awaited inside it but state.db and the loopback call to Authelia; never a Gatekeeper
  call). Revocation from offboarding or domain changes runs inside their locks and takes only the leaf.
- **R15 (token binding, C9).** The allow-list and the relay assertion carry the SHA-256 of the whole
  access token (`credential: { kind: 'bearer', clientId, tokenSha256, exp }`), not the `jti`; the
  `jti` may appear in audit lines.
- **R16 (rate limits).** The broker's limits apply to native requests only; pass-through traffic
  (plugins' device-code polling) is not throttled by them.
- **Redundancy, said plainly.** Per-request access is already cut by `resolveUserCaller` and
  Gatekeeper's checks; the broker's own value is the absolute lifetime, standing on refresh (Authelia
  has none), reuse policy, per-device listing and revocation, the allow-list, and sign-in events.
- **Proof limits.** The rodeo VMs prove the files, the redirect page and the protocol; whether iOS
  (≥ 17.4, `ASWebAuthenticationSession` with an HTTPS callback, `webcredentials`) and Android
  (Custom Tabs + verified App Links) hand the redirect to the app needs devices or emulators —
  reported as outside this proof (Q4).

## As implemented (2026-11-10)

Lamaste `feat/native-app-signin`: wave 1 core `f95978d0` (+ `b9cd0368`), wave 2a serverd broker and grants `365a1129`,
wave 2b Gatekeeper bearer path, hosts, files and events `3fb6f618`, `c5321b16`, wave 3 panel, CLI and desktop
`545df6d3`, then the docs. Where the code differs from the plan above:

- **Names.** Core root modules `native-apps.ts` (rules, schemas, association files, the projection; also the
  browser-safe subpath `@lamalibre/lamaste/native-apps` for the panel UI), `native-token.ts` (verifier, JWKS parser,
  `bearerTokenOf`, grace sealing), `sign-in-events.ts`; `./server` `renderNativeClient`,
  `renderNativeClientLifespans`, `renderNativeClientPolicies`, `HOST_ACCESS_FACTOR`, `renderNativeRedirectPage`;
  `./agent` `createSignInEventsHandler`. serverd `lib/native-apps.js`, `lib/native-grants.js`, `lib/native-broker.js`,
  `lib/native-files.js`, `lib/sign-in-events.js`, `routes/native-oauth.js`, `routes/management/native-apps.js`;
  Gatekeeper `lib/issuer-keys.ts`. Each native client's Authelia lifespan reuses its policy name
  `lamaste_client_<id>`.
- **Factor (R4).** `HOST_ACCESS_FACTOR` (`two_factor`) is one constant used by the domain's host access rules and by
  native clients' policies.
- **Cross-agent (D1/R3).** First confirmed once per tunnel (`userSurface.originAgent`); since the implementation's
  security review (M2, below) per route: `userSurface.crossAgent: [{ route, agent, hostingAgent }]`. The served-route reason is `cross_agent_unconfirmed` for a plugin another agent
  hosts without a confirmation for the tunnel's current agent; `not_hosting_agent` now means no agent hosts it or none
  carries the tunnel. Deciding whether a tunnel serves a route also checks identity and approval.
- **R2.** Every bound route is rendered; one not served gets a `503` JSON location. Binding therefore rewrites the
  vhost at once.
- **Sites (D1).** A joined route is served only while the owner's own surface is served (`site_not_served`); the
  shell admits a member of the audience of any served route. API `PUT|DELETE /api/plugins/:name/web-surface/routes/:route`,
  refusals `invalid_route`, `not_found`, `not_agent_hosted`, `not_plugin_domain`, `served_elsewhere`,
  `too_many_routes`.
- **Served clients.** Enabled, host entry present, under an active domain — a host that binds no route at the
  moment keeps its client in Authelia (only standing is "unavailable"), so a temporary unbind ends no grant.
- **Standing** counts roles on every bound route (not only served ones): a hosting down for a while ends nobody's
  grant.
- **Broker.** A code exchange without `offline_access` is refused (`invalid_scope`). Revoking a grant marks its
  current token spent (no second reuse report later). Concurrent refreshes with one token: the second gets the grace
  answer. Rate limits are in-memory fixed windows. The panel's own rate limit is off on the broker's routes.
- **Host moves.** Moving a plugin's surface from a tunnel to its own site moves the tunnel's native client when that
  tunnel served that plugin alone (`native-app.host.moved`).
- **Audit.** One `native-app.grant.revoked` per revocation call (count + ≤ 20 ids); `plugin.web-surface.route.joined|left`,
  `plugin.sign-in-events.dropped`; `tunnel.user-surface.bound` with `reason: "cross-agent"`.
- **Relay assertion.** A panel caller with any field but `type`, `username`, `credential` is refused as malformed; the
  `credential` is accepted only on a user-surface target.
- **Files** at `/var/www/lamaste/native/<fqdn>/{apple-app-site-association,assetlinks.json,redirect.html}` (root
  overridable with `LAMALIBRE_LAMASTE_NATIVE_FILES_ROOT`); the tunnel vhost gets the native locations through
  `tunnel-deps.js`, and a vhost write fails rather than being written without them when the client lookup fails.
- **Sign-in events.** Delivered on a 30 s tick and right after each sign-in; sealed with `sealPluginJson` (shared with
  identity changes), salt `lamaste/sign-in-events/v1`.
- **R11 on a live nginx:** `auth_request_set` keeps Gatekeeper's refusal header on a `401` — three-VM 63 sees
  `{"error":"invalid_token"}` and `WWW-Authenticate: Bearer error="invalid_token"` from nginx.

### Security review (2026-11-10)

An independent review of the implementation (`b21c0d60..017995ff`) found one high, two medium and five low issues; all
are fixed, each with unit tests.

- **H1 — a multipart body skipped the broker.** The broker read only form bodies; anything else was "not native" and
  passed to Authelia, which also reads `multipart/form-data` (Go's `ParseMultipartForm`) — confirmed on 4.39.28: a
  multipart refresh of a native client's token answered 200 and rotated, outside every Lamaste rule. Fixed: both
  endpoints refuse, for every client and before classifying, a body whose media type is not exactly
  `application/x-www-form-urlencoded` (parameters and case ignored; none is refused) or that is content-encoded
  (`400 invalid_request`; `bodyRefusal`). Also verified: Authelia does not read token parameters from the query
  string. Classification further counts a `client_assertion`'s `iss`/`sub` (native → refused, public clients do not
  authenticate), and a `Basic` header the broker cannot read is refused (`401`), never passed on.
- **M1 — a native client on a public host.** A client stays served only while its host is enabled and not public
  (`reason` `host_public`, `host_disabled`); a tunnel with a native client (served or not) cannot be made public
  (`409`, `code: native_client_conflict`, core `UserSurfaceDeps.hasNativeClient`); and every backend location of a host
  with a native client — public vhosts too — clears `Authorization` and hides the backend's `WWW-Authenticate`
  (`nginx.js` `NATIVE_BACKEND_GUARD`, `native-files.js` `nativeGuardOf`; `lamaste-priv` allows `proxy_hide_header
<name>` in a location).
- **M2 — the cross-agent confirmation was per tunnel.** A confirmation given for one plugin covered any other bound
  plugin later hosted elsewhere. Now per route, naming both agents as they were (`userSurface.crossAgent: [{ route,
agent, hostingAgent }]`, core `tunnelCrossAgentConfirmations`, `isCrossAgentConfirmed`); served only while both are
  still so; all of a tunnel's go when its agent changes or is dropped; a route's go everywhere when its plugin's
  internal tunnel is created, removed, reassigned or released (core `forgetCrossAgentRoute`). Binding an already bound
  route again with `crossAgent: true` now records a confirmation (the "bind it again" the status texts ask for). The
  pre-release `originAgent` field confirms nothing.
- **L1** — a client deleted or no longer served while Authelia answered a code exchange: the issued refresh token is
  revoked there and the app gets `invalid_client` (it was a 500).
- **L2** — the grace answer now checks the portal's domain (R5), the grant's lifetimes and the person's standing (the
  directory part) before it is given.
- **L3** — Gatekeeper takes the bearer path only for the `Bearer` scheme; any other `Authorization` (a cached Basic
  login) is ignored and the session decides.
- **L4** — redirect paths may not lie under `/internal` (an exact location there collided with the renderers' own);
  the docs say a redirect path shadows whatever the backend or shell serves there.
- **L5** — a live token for a route or client not served for now (a hosting moving, a host disabled) is `503`, not
  `401`; the broker computes standing — Gatekeeper's answer included — before the grant's lock (R14), the commit's
  compare-and-swap still deciding; sign-in event delivery drops the events of a person no longer in the plugin's
  audience. Documented: a joined route's audience can load the owner's shell.

### Rodeo (2026-11-10)

Fresh VMs, the branch rebased on `release/4.13.0` (`8ae8dc12`), the candidate on the development Feria:

- **Three-VM** — 63 sign-in (PKCE S256 only, the code through the broker, the JWT's issuer/audience/client/lifetime,
  bearer calls to a site's two plugins and a cross-agent tunnel, the association files and redirect page, R11) 117/117;
  64 refresh (rotation, the grace answer, reuse ending the grant with its audit and notification, idle and absolute
  lifetimes, revocation by the app and the admin, a client disabled and enabled) 70/70; 65 standing (disabled,
  erased, removed from the domain, the last role lost — each grant ended with its reason, tokens refused, the audit;
  sign-in events reach only the plugin that declares them) 52/52. Regressions: 01 55, 31 45, 40 121, 42 61, 48 42,
  57 63, 59 47.
- **Single-VM** — 40 (the client API's refusals, Authelia's rendering, the broker's form-only bodies and pass-through,
  the public-host refusals, the CLI) 77/77; 01 12, 03 4, 26 69, 27 49 (+1 skip, as always: no agent on that host), 32 186.
- **What the runs found.** In the specs: usernames are per run (one that reached an OIDC client is never given out
  again), grants are read as the API answers them (`endedAt`/`endedReason`), 64 signs in to Authelia again after
  the client is enabled again (that restarts Authelia, whose sessions live in memory), and the app-plugin harness no
  longer calls `lamaste-apphost remove` after an uninstall (unsigned, it waited for a job on stdin for 120 s a route).
  In Lamaste: a refused `PATCH /api/tunnels/:id` now names its conflict (`user_surface_conflict`,
  `native_client_conflict`). Outside this feature: a burst of chisel restarts (three plugins uninstalled within
  seconds) left `chisel.service` in `start-limit-hit` and every tunnel down — a bug since 4.0.0, fixed for 4.13.1.

## Decided questions (founder, 2026-11-10)

- **Q1 — native sign-ins only.** Browser sign-ins are not events (Authelia emits none); Lamaste does not watch
  Authelia's authentication log. Directories show browser users' last activity.
- **Q2 — one consent per device sign-in is accepted.** `offline_access` makes Authelia ask every time (remembered
  consent does not help); at most every 90 days per device.
- **Q3 — the self-service device page is a later release.** 4.14 has the administrator's view (Native Apps, Users →
  devices) and the app's own sign-out; a page on `auth.<domain>` like the inviter's is its own slice.
- **Q4 — the device check belongs to the product's app.** Lamaste's rodeo proves the association files, the redirect
  page and the protocol; the first app built on it checks the claimed HTTPS redirect on iOS ≥ 17.4 and Android.
