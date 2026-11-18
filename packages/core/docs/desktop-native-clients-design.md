# Desktop Native Clients — Design Document

> **Status:** as planned, 2026-11-17 (founder's go-ahead to plan it for 4.15.0). Not implemented.
> **Release:** 4.15.0, with the agent half's key directory.
> **Builds on:** `native-apps-design.md` (native clients, the token broker, grants, the bearer path, sign-in events)
> and its reference [Native Apps](04-api-reference/native-apps.md). Everything there holds unless this document says otherwise.

## Goal

A desktop application — Windows first, macOS and Linux alike — signs a person in through the
relay's identity and calls the `/api/<route>/app/*` user-surface APIs of agent-hosted app plugins
with a bearer token, exactly as a 4.14 mobile native client does. It has the same grants, rotation,
reuse detection, standing checks, revocation per device and sign-in events. The agent half cannot
tell a desktop caller from a mobile one or a browser: it receives the same signed `user` caller.

What a desktop app cannot do is what mobile clients rely on: claim an HTTPS redirect on the
application host through iOS Universal Links or Android App Links. So a desktop client differs
from a mobile one in **one** thing — where the authorization response is delivered — and in
everything that follows from it (no association files, no redirect page on the host).

Typical use: an unattended workstation (a point of sale, a kiosk) signed in once by a dedicated
account, which may stay offline for hours or days and must keep its own data and outbox meanwhile.
Nothing in the plugin's manifest changes.

## What Authelia 4.39.28 does — verified 2026-11-17

Checked against `authelia/authelia:4.39.28` in Docker, with the client this design renders (public,
`token_endpoint_auth_method: none`, PKCE `S256` required, `openid offline_access profile`, RS256 JWT
access tokens, `requested_audience_mode: implicit`, its own lifespan and claims policy, explicit
consent), registered with `redirect_uris: [http://127.0.0.1/callback, com.example.desk:/callback]`.
A script signed in through `/api/firstfactor`, then drove `/api/oidc/authorization`,
`/api/oidc/consent` and `/api/oidc/token` with `X-Forwarded-Proto/Host`.

| Fact                                                                                                                                                                                                                                                                | Consequence                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| The configuration is accepted: a public client may register an `http://127.0.0.1/<path>` redirect and a private-use scheme redirect.                                                                                                                                | No Authelia change, no template change.                        |
| `http://127.0.0.1:54321/callback` and `http://127.0.0.1:61000/callback` against the registration `http://127.0.0.1/callback`: the code is delivered **to the port asked for**. Authelia compares a loopback IP literal's redirect without its port (RFC 8252 §7.3). | The app picks any free port. Register the URI without a port.  |
| The path is compared exactly: `http://127.0.0.1:54321/other` is refused.                                                                                                                                                                                            | Lamaste registers exact paths.                                 |
| `http://localhost:54321/callback`, `http://[::1]:54321/callback` and `https://127.0.0.1:54321/callback` are refused against the `127.0.0.1` registration.                                                                                                           | One form: `http://127.0.0.1`.                                  |
| The token exchange must name the redirect URI of the authorization request, port included: another port is `400 invalid_grant`.                                                                                                                                     | Standard; the app keeps the URI it used.                       |
| A refused redirect is never redirected to: Authelia shows its error on `auth.<domain>`.                                                                                                                                                                             | A wrong registration cannot leak a code.                       |
| The exchange returns a refresh token; a refresh succeeds; the access token carries `aud: ["https://<host>"]` and `preferred_username`.                                                                                                                              | The broker, the bearer path and the allow-list work unchanged. |
| The private-use scheme `com.example.desk:/callback` works the same way (code, exchange, refresh); an unregistered path under that scheme is refused.                                                                                                                | Possible, but not adopted (D2).                                |

## Design

### D1. A kind of native client

`native_clients` gains `kind TEXT NOT NULL DEFAULT 'mobile' CHECK (kind IN ('mobile','desktop'))`
(migration `0025_native_client_kinds.sql`; every existing client is `mobile`). The unique key moves
from `(host_kind, host_id)` to `(host_kind, host_id, kind)`. A host has **at most one client of each
kind**: a mobile app and a desktop app of one application each get their own client id, consent
name, redirects and lifetimes. They share the host's one audience, so an access token of either
serves every plugin on the host, as today.

Everything keyed by client is unchanged and covers both kinds: the id form `lamaste-native-<slug>`,
the broker (`routes/native-oauth.js` finds a native client by id, of any kind), grants and
standing (`lib/native-grants.js`), the bearer path (Gatekeeper admits a token whose `client_id` is a
served native client of the host, of any kind; the panel's allow-list), revocation (every event in
`native-apps-design.md` D4), sign-in events, the Authelia authorization policy
`lamaste_client_<id>`, the host's native guard (`nativeGuardOf`: a host with a client of either kind
clears `Authorization` and hides `WWW-Authenticate` toward every backend, and cannot be made public).

### D2. The redirect: loopback only

A desktop client registers **1–4 loopback paths**. Each is rendered as the redirect URI
`http://127.0.0.1<path>`, with no port (verified above). The path rule is the mobile redirect-path rule
(`isNativeRedirectPath`: `^/[A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*$`, ≤ 128, no dot segments). The
`/api/` and `/.well-known/` exclusions do not apply: the path is on the device, not on the host.

**Why loopback and not a private-use scheme.**

- On Windows, macOS and Linux any installed program can register any scheme. The OS neither
  verifies nor arbitrates a claim, so the scheme names nothing about the app (RFC 8252 §8.6).
- Registering a scheme needs installer work per OS. A loopback listener needs none. It is the form
  RFC 8252 §7.3 recommends for desktop apps, and Tauri apps do it with the standard library.
- PKCE `S256`, required, makes an intercepted code useless either way. Loopback adds that only a
  process already running on the device, listening on that very port, could receive the code at all.

The scheme form works with Authelia (verified) and stays a later option, should a platform need
it. It is not built in 4.15.0.

**Not adopted:** `localhost` (it may resolve elsewhere, and is refused against the IP registration
anyway), `[::1]` (one form is enough; IPv4 loopback exists on every supported OS), `https` loopback
(no certificate to present).

### D3. What a desktop client does not have

- **No association files** (`apple-app-site-association`, `assetlinks.json`): `associations` is
  refused for `kind: desktop`.
- **No redirect page on the host**: the host's vhost gains no location for a desktop client.
  `native-files.js` writes nothing for it. With only a desktop client, the host serves no
  `/.well-known/` files and no redirect paths.
- Nothing else in nginx changes. The native guard (D1) already applies to a host with any native
  client.

### D4. Lifetimes for unattended devices

Unchanged rules, unchanged bounds: access token 5–15 minutes, idle and absolute 1–365 days, idle ≤
absolute, defaults 30 / 90. A device offline for longer than `idleDays` has its next refresh refused
(`idle_expired`) and must sign in again. An unattended device's administrator sets `idleDays` above
the longest outage expected and `absoluteDays` to how often a fresh sign-in is acceptable (up to a
year). The broker's clock decides first, Authelia's refresh lifespan (= `idleDays`) second, as for
mobile clients.

Each sign-in asks for consent (Authelia does for `offline_access`, verified 2026-11-10). That is once
per device sign-in, not per refresh.

### D5. API, CLI, panel, AdminClient

- **API.** `POST /api/native-apps` takes `kind` (`mobile` default, so 4.14 callers are unchanged).
  A mobile client takes `redirectPaths` and `associations`, as now. A desktop client takes
  `loopbackPaths` and refuses `redirectPaths` and `associations`. `PATCH` cannot change `kind`
  (delete and create). `GET` answers `kind` and, for desktop, `loopbackPaths` and the rendered
  `redirectUris`. A second client of the same kind on a host is `409 native_client_exists`, as now
  (the message names the kind). Audit entries gain `kind`.
- **Core.** `NativeClientCreateSchema` becomes a discriminated union on `kind`. Core gains
  `NATIVE_CLIENT_KINDS` and `nativeLoopbackRedirectUris`. `AutheliaNativeClient` gains `kind` and
  `loopbackPaths`, and `renderNativeClient` renders the loopback URIs for desktop. `native-apps.md`
  documents both kinds. All of it is browser-safe in `./native-apps`.
- **CLI.** `lamaste-server native-apps create … --kind desktop --loopback-path /callback`.
  `list` shows the kind; `update --loopback-path`.
- **Panel.** On the Native Apps page, the create dialog chooses Mobile or Desktop. Desktop shows
  loopback paths and the resulting redirect URI, and no associations. The list shows the kind. Grants,
  devices and revocation are unchanged.
- **AdminClient and desktop.** `NativeApp` gains `kind`, `loopbackPaths`, `redirectUris`; the
  create and update bodies gain the same fields. The Rust `admin_*` commands pass them through.

### D6. What the app must do (published in `native-apps.md`)

1. Discover the issuer: `https://auth.<domain>/.well-known/openid-configuration`.
2. Bind a TCP listener on **`127.0.0.1`** only, on port 0 (any free port), before opening the
   browser. Never bind `0.0.0.0`.
3. Open the **system browser**, never an embedded webview (RFC 8252 §8.12), with
   `response_type=code`, `client_id`, `redirect_uri=http://127.0.0.1:<port><registered path>`,
   `scope=openid offline_access profile`, a fresh `state`, and PKCE `code_challenge` (S256).
4. Accept one request on the listener. Check `state`, answer a small page saying the window can be
   closed, close the listener.
5. Exchange the code at the token endpoint with the **same** `redirect_uri` and the `code_verifier`.
   Optionally send `device_name` (≤ 64 printable characters).
6. Keep the refresh token in the OS credential store (Windows Credential Manager, macOS Keychain,
   libsecret), never in a file. Keep the access token in memory.
7. Refresh **one at a time**: a second concurrent refresh with the same token is reuse, and ends the
   grant.
8. On `invalid_grant` at refresh, sign in again. Its idle or absolute lifetime ended, or the person
   lost their standing.
9. Sign out by calling the revocation endpoint with the refresh token.
10. Call `https://<host>/api/<route>/app/*` with `Authorization: Bearer <access token>`.

### D7. Security notes

- **The code on the loopback** reaches whatever process listens on that port of the device. PKCE
  makes it useless to anyone without the verifier, and the app holds the verifier only in memory.
  `state` binds the response to the request. Binding `127.0.0.1` keeps the listener off the network.
- **A desktop device is less contained than a phone.** Another program running as the same OS user
  can read the user's credential store. This is the device's trust boundary, not the relay's.
  Revocation per device (panel, CLI) is the answer to a lost or compromised workstation, and the
  dedicated account of an unattended device should hold only the role it needs in the plugin.
- **No new path on the relay.** A desktop client adds no location, no file and no public endpoint.
  It is one more `clients[]` entry and its policy, rendered under the domain rendering lock like
  every other client.

## Proof (to run before release)

- **Unit**
  - Core: the schema per kind, the rendered client (loopback URIs, no port, no associations), a
    mobile client rendered byte for byte as in 4.14.
  - serverd: the migration on a 4.14 database (every client `mobile`), one client of each kind on a
    host, a second of the same kind `409`, `kind` immutable, no files written for a desktop client,
    the broker and the bearer path for a desktop client's tokens.
- **Rodeo, three-VM spec 71** (new): a desktop client on a plugin's site. A script on the visitor
  VM plays the app: it binds a loopback listener, signs in through the portal, receives the code on
  its port, exchanges and refreshes, and calls `/app/*` with the bearer token. The spec checks that
  the agent half sees the same `user` caller, that a reused refresh token ends the grant and that
  revocation from the panel ends it. It also checks that the host serves no association files or
  redirect page, and that a mobile client on the same host keeps working beside it.
- **Regressions**: three-VM 63–65 (mobile native apps) and single-VM 40, unchanged.

## Waves

1. Core: kinds, schemas, rendering, browser-safe constants; `native-apps.md`.
2. serverd: migration `0025`, `lib/native-apps.js` per kind, the API, audit, files only for mobile.
3. CLI, panel, AdminClient, desktop commands.
4. Spec 71; rodeo on fresh VMs with the 4.15.0 candidate.
