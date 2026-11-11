# Native Apps

> A native (mobile) app signs a person in through the relay's sign-in and calls the user surfaces of the agent-hosted plugins on one host with a bearer token, checked exactly as a browser session is. Design: [`native-apps-design.md`](../native-apps-design.md).

## In Plain English

A plugin's users normally reach it in a browser: Authelia signs them in, and Gatekeeper vouches for their session on the plugin's host. A phone app has no browser session. Instead, an administrator registers a **native client** for the **application host** — a plugin-owned site, or a tunnel bound to plugin routes — and the app signs people in with OpenID Connect (authorization code with PKCE) on the domain's sign-in page. It then sends `Authorization: Bearer <access token>` to `https://<host>/api/<route>/app/*` for every plugin the host serves. Each person's sign-in on one device is a **grant**: its refresh tokens rotate on every use, and it ends when the person's standing ends — disabled, removed, out of the domain, or without a role on the host's plugins — or when an administrator or the app ends it.

## Application hosts

A native client belongs to one application host, and one host has at most one native client. The host is where everything the app needs lives: every plugin's `/api/<route>/app/*`, the app's redirect paths, and the app association files. Its **audience** is `https://<fqdn>`, so one access token serves every plugin on it.

A host serves several plugins:

- **A plugin-owned site** serves its owner's route and the routes an administrator **joins** to it — each served while its plugin is installed, approved, declares `identity` and is hosted (by any agent), and the site itself is served ([Agent-Hosted Plugins → Web surface](agent-hosted-plugins.md#joined-plugins)).
- **A tunnel** serves the routes bound to it whose plugin its agent hosts, and — bound **across agents** with `crossAgent: true` — a route another agent hosts, while the agent that carried the tunnel and the agent that hosted the plugin when it was bound still do (a confirmation is per route) ([Tunnels API → User Surface Binding](tunnels.md#user-surface-binding)).

A route is served on one host at most. On every host, a bound route that is not served is answered by the relay (`503 { "error": "The plugin is not available right now" }` from nginx) — never by the tunnel's backend — and on a host with a native client no location passes `Authorization` to a backend.

## Native clients

Admin certificate only. Stored in the panel's `state.db` (`native_clients`, migration `0023`).

| Field                | Type                   | Notes                                                                                                                                                                                                                                           |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientId`           | `string`               | `lamaste-native-<slug>`; slug: 1–40 lower-case letters, digits and inner hyphens. The `lamaste-` prefix is Lamaste's: a plugin manifest may not declare such an OIDC client                                                                     |
| `hostKind`, `hostId` | `site` \| `tunnel`, id | The application host. Its `fqdn` and `domain` are derived on every read                                                                                                                                                                         |
| `name`               | `string`               | 1–100 characters; shown on Authelia's consent screen                                                                                                                                                                                            |
| `redirectPaths`      | `string[]`             | 1–4 paths on the host (`/a/b`, ≤ 128, no dot segments, not under `/api/`, `/.well-known/` or `/internal/`); the redirect URIs are `https://<fqdn><path>`. The host answers them itself — in place of whatever its backend or shell serves there |
| `accessTokenMinutes` | `number`               | 5–15, default 15                                                                                                                                                                                                                                |
| `idleDays`           | `number`               | 1–365, default 30 — a grant ends when not refreshed for this long                                                                                                                                                                               |
| `absoluteDays`       | `number`               | 1–365, default 90 — a grant ends this long after sign-in; `idleDays ≤ absoluteDays`                                                                                                                                                             |
| `associations`       | `object`               | [App association files](#app-association-files)                                                                                                                                                                                                 |
| `enabled`            | `boolean`              | A disabled client is not rendered into Authelia (no sign-ins) and every grant of it ends                                                                                                                                                        |

A client is **served** — rendered into Authelia's OIDC provider — while it is enabled, its host entry exists, is enabled and not public, and lies under an active domain. Otherwise `served: false` with a `reason`: `disabled`, `host_missing`, `host_public`, `host_disabled`, `domain_inactive`. A tunnel with a native client cannot be made public (`PATCH /api/tunnels/:id` answers `409` with `code: native_client_conflict`), and every backend location of a host with a native client, served or not, clears `Authorization` and hides the backend's `WWW-Authenticate`.

**In Authelia** (core `renderNativeClient`): `public: true`, `token_endpoint_auth_method: none`, `require_pkce: true`, `pkce_challenge_method: S256`, `grant_types: [authorization_code, refresh_token]`, `response_types: [code]`, `scopes: [openid, offline_access, profile]`, `access_token_signed_response_alg: RS256` (a JWT `typ: at+jwt`), `requested_audience_mode: implicit` with `audience: [https://<fqdn>]`, a claims policy putting `preferred_username` in the access token, `consent_mode: explicit` (`offline_access` makes Authelia ask for consent at every sign-in in any mode), a lifespan `lamaste_client_<id>` (access and ID tokens `accessTokenMinutes`, refresh token `idleDays`), and the authorization policy `lamaste_client_<id>`: the members of the host's domain, and its external members granted the host, with `two_factor` — the factor the domain's access rules ask of its hosts' members (`HOST_ACCESS_FACTOR`). A change restarts Authelia.

### `GET /api/native-apps`

```json
{
  "clients": [
    {
      "clientId": "lamaste-native-shop",
      "hostKind": "site",
      "hostId": "6c0d…",
      "name": "Shop",
      "redirectPaths": ["/oauth/callback"],
      "accessTokenMinutes": 15,
      "idleDays": 30,
      "absoluteDays": 90,
      "associations": { "ios": { "teamId": "ABCDE12345", "bundleIds": ["com.example.shop"] } },
      "enabled": true,
      "createdAt": "2026-11-10T09:00:00.000Z",
      "updatedAt": "2026-11-10T09:00:00.000Z",
      "fqdn": "shop.example.com",
      "domain": "example.com",
      "served": true,
      "audience": "https://shop.example.com",
      "redirectUris": ["https://shop.example.com/oauth/callback"],
      "accessMode": "restricted",
      "routes": ["shop", "news"],
      "servedRoutes": ["shop", "news"]
    }
  ]
}
```

### `POST /api/native-apps`

Body: `{ slug, hostKind, hostId, name, redirectPaths, accessTokenMinutes?, idleDays?, absoluteDays?, associations?, enabled? }` (core `NativeClientCreateSchema`, strict). `201 { client, warnings? }`. Refused: `400 invalid_request` (the body), `400 not_an_application_host` (no plugin-owned site or bound tunnel under an active domain), `409 client_exists`, `409 host_has_client`. Audit `native-app.created`.

### `GET /api/native-apps/:clientId`

`{ client }`, or `404 not_found`.

### `PATCH /api/native-apps/:clientId`

Any of `name`, `redirectPaths`, `accessTokenMinutes`, `idleDays`, `absoluteDays`, `associations`, `enabled` (core `NativeClientUpdateSchema`; the host never changes). `{ client, warnings? }`. Disabling ends every grant (`client_disabled`). Audit `native-app.updated`, `native-app.enabled`, `native-app.disabled`.

### `DELETE /api/native-apps/:clientId`

Every grant ends (`client_deleted`); the host stops serving the association files and redirect paths. `{ ok: true, warnings? }`. Deleting the host (the tunnel, the site) deletes its client (`host_deleted`). Moving a plugin's user surface from a tunnel to its own site moves the tunnel's client with it when the tunnel served that plugin alone (`native-app.host.moved`). Audit `native-app.deleted`.

## Signing in

The app uses the domain's standard OpenID Connect endpoints (`https://auth.<domain>/.well-known/openid-configuration`):

1. Opens `https://auth.<domain>/api/oidc/authorization?client_id=<id>&response_type=code&redirect_uri=https://<fqdn><path>&scope=openid%20offline_access%20profile&code_challenge=<S256>&code_challenge_method=S256&state=…` in the system browser (`ASWebAuthenticationSession`, Custom Tabs). The person signs in (two factors), Authelia applies the client's authorization policy, asks for consent, and redirects to the claimed redirect URI with `code`. `plain` or a missing challenge is refused (`invalid_request` to the redirect URI), as is a person the policy refuses (`access_denied`).
2. Exchanges the code at `https://auth.<domain>/api/oidc/token` (`grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`) and, optionally, `device_name` (≤ 64 printable characters — Lamaste's own parameter, removed before Authelia sees the request; it names the device in grant listings). The answer is Authelia's: `access_token` (JWT, `expires_in` up to 900), `refresh_token`, `id_token`.
3. Calls the host's plugins with `Authorization: Bearer <access_token>`, and refreshes (`grant_type=refresh_token`, `refresh_token`, `client_id`) **one at a time**, always with the latest refresh token.
4. Signs out by revoking its refresh token at `https://auth.<domain>/api/oidc/revocation` (`token`, `client_id`): the grant ends.

## The token broker

nginx sends `auth.<domain>/api/oidc/token` and `/api/oidc/revocation` to the panel (`/api/native-apps/oauth/token|revocation` on its root context: no mTLS, `client_max_body_size 16k`, `Host` written as the portal's name, `X-Forwarded-Host` cleared); every other path of the portal stays Authelia's. Authelia stays the issuer — the broker decides whether a request reaches it and records what it answered.

**Only a form.** Both endpoints take exactly `application/x-www-form-urlencoded` (RFC 6749 §3.2; parameters and case of the type ignored), not content-encoded. Anything else — `multipart/form-data` above all, which Authelia would read but the broker could not — is refused for **every** client before it is classified: `400 { "error": "invalid_request" }`, nothing forwarded. A plugin client sends forms already.

**Which requests are native.** A request whose body `client_id`, `client_assertion` (`iss`/`sub`, read unchecked) **or** HTTP Basic username (`Authorization: Basic base64("<id>:")`, decoded as Authelia decodes it) names a native client (`lamaste-native-*`), or whose `refresh_token` / `token` is one the broker recorded — whatever its client fields say. Everything else — plugins' OIDC clients, device-code polling, confidential clients — is passed to Authelia **byte for byte** (body, `Content-Type`, `Accept`, `Authorization`, with `X-Forwarded-Proto: https`, `X-Forwarded-Host: auth.<domain>`, `X-Forwarded-For`), and its answer returned as it came (status, `Content-Type`, `Cache-Control`, `Pragma`, body; 10 s).

A `Basic` header the broker cannot read is refused (`401 invalid_client`), never passed on.

**A native request** must name a served native client **of the portal's own domain**, carry no `Authorization` header and no `client_assertion` (native clients are public), and use the form once per parameter. Rate limits apply to native requests only: 120 a minute per client address, 30 a minute per refresh token (`429 temporarily_unavailable`, `Retry-After`).

| Grant                | What the broker does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorization_code` | Forwards; on `200` checks the access token (issuer, audience, client) and that the client is still served (deleted or disabled meanwhile → the tokens revoked at Authelia, `401 invalid_client`), resolves `preferred_username` to the directory user and checks [standing](#standing). Standing fails → the new refresh token is revoked at Authelia at once and the app gets `400 invalid_grant`. Otherwise a grant is created with the hashes of the refresh and access tokens, a [sign-in event](#sign-in-events) is queued, and Authelia's answer returned. No `offline_access` → `400 invalid_scope`                 |
| `refresh_token`      | The token must be the grant's **current** one. Standing first (Gatekeeper's answer included, outside the grant's lock), then under the grant's lock lifetimes (idle since its last use, absolute since sign-in) and the client — any failure ends the grant and answers `invalid_grant`. Forwards; on `200` commits the rotation by compare-and-swap (old token spent, new one current, new access token recorded). A grant revoked while Authelia answered: the new refresh token is revoked at Authelia and the answer is `invalid_grant`. Authelia's `invalid_grant`/`invalid_client` ends the grant (`issuer_refused`) |
| other                | `400 unsupported_grant_type`, never forwarded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

- **A spent refresh token** within **30 seconds** of its rotation — on the client's own portal, within the grant's lifetimes and the person's standing — gets the same answer again (sealed with AES-256-GCM under a key derived from that spent token, so the database alone yields nothing usable) — a lost answer, or two refreshes racing, does not end the sign-in. After 30 seconds it is **reuse**: the grant ends (`reuse`), its access tokens stop working, `native-app.grant.reuse-detected` is audited and administrators are notified.
- **An unknown refresh token** → `invalid_grant`, never forwarded.
- **Authelia 5xx or no answer** → `503 temporarily_unavailable` (`Retry-After: 5`) and the grant kept; the third consecutive 5xx while Authelia's discovery answers ends it (`issuer_refused`) — Authelia answers `500` for a chain it revoked itself.
- **Revocation** for a native client: the grant whose current or spent token matches ends (`revoked_by_client`), the request is forwarded to Authelia too, and the answer is always `200` (RFC 7009).

Errors are OAuth's: `{ "error": "<code>", "error_description": "…" }` with `Cache-Control: no-store`. A portal that is not an active domain's answers `404`.

Only hashes are stored: the SHA-256 of each refresh token and of each access token (`native_refresh_tokens`, `native_access_tokens`), never a token. Ended grants' rows go 30 days after they ended; expired access-token rows every minute.

## Standing

A grant stands while its person:

- is `active` in the directory, with no pending cleanup of an earlier holder of the username;
- is a member of the host's domain, or an external member granted the host;
- on a `restricted` host, holds the host's Gatekeeper grant (fail closed: Gatekeeper unreachable answers `503` on a refresh and never ends a grant);
- holds a role on at least one route the host binds (roles ∩ the plugin's declared roles — a hosting that is down for a while ends nobody's grant).

It is checked at every sign-in and refresh, and grants end outside requests (`native-app.grant.revoked`, the reason and ids only) when:

| Event                                                           | Reason                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| the person is disabled, removed or erased                       | `standing:disabled`, `standing:removed`, `standing:erased`                         |
| the person leaves the domain or becomes an unpermitted external | `standing:not_member`                                                              |
| the person loses every role on the host's plugins               | `standing:no_role`                                                                 |
| the person loses the host's grant on a restricted host          | `standing:no_grant`                                                                |
| the client is disabled or deleted, the host deleted             | `client_disabled`, `client_deleted`, `host_deleted`                                |
| an administrator ends it                                        | `revoked_by_admin`                                                                 |
| lifetimes, reuse, the app signing out, Authelia refusing        | `idle_expired`, `absolute_expired`, `reuse`, `revoked_by_client`, `issuer_refused` |

Offboarding, erasure, domain membership changes and audience recomputes end grants at once; a minute's tick checks every live grant again, so a change Lamaste did not see itself (a `users.yml` edit adopted by the reconcile, a Gatekeeper outage that ended) ends grants within a minute.

## Grants

### `GET /api/native-apps/:clientId/grants?userId=&status=live|ended|all`

Default `live`.

```json
{
  "grants": [
    {
      "grantId": "0b5e…",
      "clientId": "lamaste-native-shop",
      "userId": "6f1c…",
      "username": "alice",
      "deviceName": "Alice's phone",
      "userAgent": "Shop/1.4 CFNetwork/1498 Darwin/24.0.0",
      "createdAt": "2026-11-10T09:12:00.000Z",
      "lastUsedAt": "2026-11-10T11:40:00.000Z",
      "expiresAt": "2026-12-10T11:40:00.000Z",
      "status": "live",
      "endedAt": null,
      "endedReason": null
    }
  ]
}
```

`expiresAt` is the sooner of the idle and absolute ends.

### `DELETE /api/native-apps/:clientId/grants/:grantId`

Ends one grant (`revoked_by_admin`): `{ ok: true, ended: 1 }`; `404 not_found` for a grant of another client.

### `POST /api/native-apps/:clientId/grants/revoke`

Body `{ userId }`: ends every grant the person holds with the client. `{ ok: true, ended: <n> }`.

### `GET /api/users/:username/native-grants?status=live|ended|all`

A person's grants with every native client; `404 user_not_found`.

## Bearer tokens on the user surface

A request to `https://<host>/api/<route>/app/*` carrying `Authorization` is authenticated by its token **instead of** a session cookie (a cookie beside it is ignored — a browser never attaches a bearer token by itself).

1. **Gatekeeper** (`/authz/user-surface/<fqdn>`, which already receives the request's headers) takes the bearer path for the `Bearer` scheme only — any other `Authorization` (a Basic login a browser cached for the host) is ignored and the session decides — and requires exactly `Bearer <compact JWS>` (≤ 8 KiB) and verifies it (core `verifyNativeAccessToken`): `alg: RS256`, `typ: at+jwt`, a `kid` of the issuer's key set (from Authelia's `jwks.json`, cached, fetched again on an unknown key or a bad signature at most every 30 s), the signature, `iss` = `https://auth.<domain of the host>`, `aud` containing `https://<fqdn>`, `client_id` = the host's native client (from the panel's `native-apps.json` projection; missing or unreadable → every bearer refused), `exp` in the future, `iat`/`nbf` within 30 s, a lifetime of at most 15 minutes (+30 s), a UUID `jti`, a Lamaste username in `preferred_username`. Then exactly a session's checks: domain membership (external members only where they would be admitted), the host's grant on a `restricted` host, the route served on this host. It signs the panel's relay assertion with `credential: { kind: "bearer", clientId, tokenSha256, exp }` beside the username. A token that fails → `401` with `X-Lamalibre-Refusal: invalid_token`; no keys yet → `503`.
2. **nginx** answers a bearer's `401` as `401 { "error": "invalid_token" }` with `WWW-Authenticate: Bearer error="invalid_token"` (a session's stays `{ "error": "unauthenticated" }`), and never passes `Authorization` to the panel.
3. **The panel** requires the token to be **live**: recorded by the broker for a grant that has not ended, of this client and this person, within its lifetimes — else the same `401 invalid_token`. A live token for a route or a client that is not served for now (a hosting moving, the host disabled) is `503 { "error": "The plugin is not available right now" }`, so the app keeps it. Ending a grant therefore ends its access tokens at once; an access token minted any other way than through the broker is never accepted. The rest is a browser session's path: the user resolved in the directory (active, entitled, the plugin ready) and forwarded to the agent half as the same `{ type: "user", userId, username, roles }` caller — the half never sees the token, the client or the grant. The `Origin` rule for requests that change something is waived for a bearer (a native HTTP stack sends no `Origin`, and no browser attaches the token); `Sec-Fetch-*` rules stay. An open response ends when its grant ends (`grant_revoked`).

## App association files

The client's `associations` (core `NativeAssociationsSchema`, ≤ 10 entries each):

```json
{
  "ios": { "teamId": "ABCDE12345", "bundleIds": ["com.example.shop"] },
  "android": [
    {
      "packageName": "com.example.shop",
      "sha256CertFingerprints": ["14:6D:E9:…:3B"]
    }
  ]
}
```

`teamId`: 10 upper-case letters and digits; bundle ids and package names reverse-DNS (≤ 155); fingerprints 32 colon-separated upper-case hex pairs.

The panel writes, atomically, whenever the client changes (`/var/www/lamaste/native/<fqdn>/`, `lamaste:www-data`):

- `apple-app-site-association`: `applinks` claiming **only the redirect paths** (`components: [{ "/": "<path>" }]` — the host's other links keep opening in the browser) for `<teamId>.<bundleId>`, and `webcredentials.apps`;
- `assetlinks.json`: `delegate_permission/common.handle_all_urls` per package (Android filters paths in the app's manifest);
- `redirect.html`: the page shown at a redirect path when the app is not installed.

The host's vhost serves, **before any authorization**: `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` (`application/json`, `Cache-Control: max-age=300`), and each redirect path — the static page (no script, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, a CSP by hash, in the domain's language and brand), **kept out of the access log** (its query holds an authorization code). A file a platform does not use is not served. iOS hands an HTTPS callback to `ASWebAuthenticationSession` from iOS 17.4 with `webcredentials`; Android needs verified App Links.

## Sign-in events

A plugin whose identity block declares `"signInEvents": true` ([Agent-Hosted Plugins → The identity block](agent-hosted-plugins.md#the-identity-block)) is told when one of its users signs in with the native client of the host that serves it: one event per grant created, queued for every plugin the host serves that declares it, is approved, and has the person as an active audience member then. Browser sign-ins are not events — Authelia tells Lamaste nothing about them.

```
POST /admin/identity/sign-ins   { "protocol": 1, "from": <seq>, "to": <seq>, "events": <sealed> }
  → 200 { "protocol": 1, "acknowledged": <to> }
```

`events` (sealed as identity changes are: AES-256-GCM under an HKDF key from the installation secret, salt `lamaste/sign-in-events/v1`, bound to the plugin, the caller assertion's nonce, `from` and `to`) opens to `[{ "seq": 12, "userId": "6f1c…", "at": "2026-11-10T09:12:00.000Z", "client": { "kind": "native", "clientId": "lamaste-native-shop" } }]`. At most 200 a call (256 KiB); the panel sends right after a sign-in and every 30 s, with the identity feed's preconditions (hosting active, not down), backing off from 30 s to 10 minutes after a failure. Delivery is at least once: take a repeated `seq` as the same event. An event undelivered for 7 days is dropped (`plugin.sign-in-events.dropped`, a count). Erasing a person deletes their queued events.

An agent half answers it with `createSignInEventsHandler({ verifier, onEvents })` from `@lamalibre/lamaste/agent` (caller `lamaste` only, the body hash required); the forwarder never forwards `/admin/identity*`.

## Panel, CLI, desktop

- **Panel**: **Native Apps** page — register a client for a free application host; each client's state, audience, redirect URIs, lifetimes, plugins served, association files (with their URLs), edit, enable/disable, delete, and its grants (filter by person, live/ended/all, end one); **Users** → a person's devices; a plugin's **Web surface** → Joined plugins; **Tunnels** → User surface, the cross-agent confirmation.
- **CLI**: `lamaste-server native-apps list | create <slug> --host <fqdn | id> --name <n> --redirect <path,…> [--access-minutes n] [--idle-days n] [--absolute-days n] [--ios-team t --ios-bundle id,…] [--android <package>=<fp>[,<fp>]]… [--disabled] | update <client> [settings] | enable|disable <client> | delete <client> [--yes] | grants <client> [--user <u>] [--status …] | revoke <client> --grant <id> | --user <u>`, `lamaste-server users native-grants <username>`, `plugins web-surface <name> join|leave <route>`, `tunnels bind-user-surface <tunnel> <plugin> --cross-agent`.
- **AdminClient** (web and desktop): `listNativeApps`, `createNativeApp`, `updateNativeApp`, `deleteNativeApp`, `listNativeGrants`, `revokeNativeGrant`, `revokeUserNativeGrants`, `getUserNativeGrants`, `joinWebSurfaceRoute`, `leaveWebSurfaceRoute`, `bindTunnelUserSurface(id, route, { crossAgent })`.
