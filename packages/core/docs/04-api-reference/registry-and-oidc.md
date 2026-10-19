# Registry Credential and OIDC Clients

Two generic mechanisms a plugin can build on, first used by Feria (the Lamalibre npm registry): the panel's **registry credential**, with which it brokers short-lived install tokens for agents, and **OIDC clients** that plugins register on the relay's Authelia.

## In Plain English

Agents install plugins with `npm install` from the Lamalibre registry. A networked registry accepts nothing anonymously, and an agent must never hold a long-lived registry credential. So the panel holds one credential for the registry and, each time an agent is about to install a plugin, asks the registry for a one-hour read-only token owned by that agent. The agent writes it to a throw-away npm configuration file for that one install and deletes it afterwards.

The panel's own npm calls use the same credential: installing a plugin, fetching a version to stage an update, and reading an agent package's integrity to pin it all run with npm routed to the credential's registry for its scope and authenticated with the panel's service token — through a throw-away userconfig of the same kind (0600 in a private temporary directory, named to npm as `npm_config_userconfig`, removed once npm has run), never the service account's `~/.npmrc`. A registry that answers `401` has the token obtained again once; a token still refused, or `403`, fails the operation naming the registry and the status. Without a credential the panel's npm runs as the machine configures it (the public registry by default).

The panel itself can authenticate to the registry in two ways: with a long-lived token an administrator pasted in, or — the recommended way — as its own **service principal**: an OpenID Connect client on the relay's Authelia named `lamaste-server`. In that mode nothing long-lived is pasted anywhere; the panel proves its identity to Authelia with a secret it generated itself, Authelia issues a short-lived JWT, and the registry exchanges that JWT for a registry token.

Plugins use the same Authelia to let people and programs log in. A plugin's manifest declares its OIDC clients — a CLI that logs in with the device-code flow, a service that authenticates with client credentials — and the panel writes them into Authelia's configuration when the plugin is enabled.

## Plugin manifest: `oidcClients`

```json
{
  "name": "feria",
  "oidcClients": [
    {
      "id": "feria-cli",
      "name": "Feria CLI",
      "grantTypes": ["urn:ietf:params:oauth:grant-type:device_code"],
      "scopes": ["openid", "profile", "groups"],
      "audience": ["https://feria.{domain}"],
      "accessTokenClaims": ["groups", "preferred_username"]
    },
    {
      "id": "feria-ci",
      "confidential": true,
      "grantTypes": ["client_credentials"],
      "scopes": ["registry_publish"],
      "audience": ["https://feria.{domain}"]
    }
  ]
}
```

| Field                          | Default           | Meaning                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                           | —                 | Client id. Must be the plugin's route (`feria` for `@lamalibre/feria-server`) or `<route>-<suffix>`; one plugin cannot claim another's client                                                                                                                                                                     |
| `name`                         | `<plugin> (<id>)` | Shown on Authelia's consent screen                                                                                                                                                                                                                                                                                |
| `grantTypes`                   | —                 | Any of `urn:ietf:params:oauth:grant-type:device_code`, `authorization_code`, `refresh_token`, `client_credentials`. `client_credentials` requires `confidential: true`; `authorization_code` requires `redirectUris`. A client whose only grant is `client_credentials` may not have `openid` or `offline_access` |
| `scopes`                       | `["openid"]`      | Scopes the client may request (lowercase letters and underscores)                                                                                                                                                                                                                                                 |
| `audience`                     | `[]`              | Audiences the client may request; `{domain}` becomes the relay domain. Clients must request an audience explicitly (`requested_audience_mode: explicit`)                                                                                                                                                          |
| `redirectUris`                 | `[]`              | For `authorization_code`; `{domain}` is expanded                                                                                                                                                                                                                                                                  |
| `accessTokenSignedResponseAlg` | `RS256`           | `RS256` makes access tokens JWTs (RFC 9068) a resource server verifies against Authelia's JWKS; `none` keeps them opaque                                                                                                                                                                                          |
| `accessTokenClaims`            | `[]`              | Claims copied into the JWT access token through a per-client claims policy: `groups` (needs the `groups` scope), `preferred_username` and `name` (`profile`), `email` (`email`). Without a policy Authelia puts these claims only in the UserInfo response                                                        |
| `authorizationPolicy`          | `two_factor`      | `one_factor` or `two_factor` for the user-facing grants. A client with the `client_credentials` grant has no end user: Authelia requires `one_factor` there, so it defaults to `one_factor` and `two_factor` is rejected                                                                                          |
| `requirePkce`                  | `false`           | Require PKCE on authorization-code requests                                                                                                                                                                                                                                                                       |
| `confidential`                 | `false`           | A confidential client authenticates to the token endpoint with a secret (`client_secret_basic`). Lamaste generates the secret                                                                                                                                                                                     |

What the panel writes for a public client: `public: true`, `token_endpoint_auth_method: none`, `consent_mode: explicit`. For a confidential client: `client_secret` as a pbkdf2-sha512 digest (`$pbkdf2-sha512$310000$<salt>$<key>`), `token_endpoint_auth_method: client_secret_basic`, and no consent mode when the only grant is `client_credentials`. Any client with the `client_credentials` grant is rendered with `authorization_policy: one_factor` and may not carry the `openid`, `offline` or `offline_access` scopes — Authelia 4.39 refuses the configuration otherwise (`validator/identity_providers.go`). A client with `accessTokenClaims` gets `claims_policy: <id>` and a policy of the same name under `identity_providers.oidc.claims_policies` with `access_token: [...]`.

### Secrets of confidential clients

The panel mints a 32-byte secret when a confidential client first appears (at install — the secret belongs to an installed plugin, enabled or not), stores the plaintext in `/etc/lamalibre/lamaste/oidc-clients.json` (0600) and writes only the digest into Authelia. The plaintext is shown exactly once: in the response of the `POST /api/plugins/install` (or `enable`) call that created it, as `oidcClients: [{ id, secret }]` — or, when an update of an agent-hosted plugin adds the client, on the first read of the finished update operation ([Operations](lifecycle-hooks.md#operations)) — and again by `rotate-secret`. Uninstalling the plugin deletes the secret; disabling keeps it.

The panel's Plugins page — and the desktop app, which reuses it — shows the secrets an install, enable or update created in a dialog the administrator must acknowledge: each client id with its secret and a copy button, and the warning that it is shown once. The secrets go from the response to that dialog only: not into the page's query cache, the browser's storage or a log, and they are gone once acknowledged. An update started from the page is read as it ends. One started elsewhere — another panel, `lamaste-server`, or the page before a reload — is offered on the plugin's card (**Show the secrets**) instead of read unasked, so the CLI following its own update still prints them.

### Where the clients are served

Authelia serves its OpenID Connect provider at `https://auth.<domain>`: `/.well-known/openid-configuration`, `/jwks.json`, `/api/oidc/device-authorization`, `/api/oidc/token`, `/api/oidc/userinfo`. The section is written only while at least one client exists — Authelia refuses an `oidc` section without clients.

Tokens are signed with an RSA-4096 key at `/etc/authelia/oidc-issuer.pem`, generated by `create-lamaste` (fresh install and every redeploy that finds it missing), owned by the `lamaste-authelia` account, mode 0600. The panel, which writes Authelia's configuration, cannot read it: the configuration references the key with a template expression — `key: {{ secret "/etc/authelia/oidc-issuer.pem" | mindent 10 "|" | msquote }}` — which Authelia expands at load time because its unit sets `X_AUTHELIA_CONFIG_FILTERS=template`. The whole file is then a Go template, so the panel refuses to write any value containing `{{` or `}}`.

### Agent-hosted plugins: clients without code on the relay

An application that runs on its own agent, behind a Lamaste tunnel, still needs its clients on the relay's Authelia — Feria's `feria-cli` is the first. Its manifest says so with `"hosting": "agent"` (default `"server"`):

```json
{
  "name": "feria",
  "version": "0.3.1",
  "hosting": "agent",
  "oidcClients": [
    {
      "id": "feria-cli",
      "grantTypes": ["urn:ietf:params:oauth:grant-type:device_code"],
      "scopes": ["openid", "profile", "groups"],
      "audience": ["https://feria.{domain}"],
      "accessTokenClaims": ["groups", "preferred_username"]
    }
  ]
}
```

It is installed like any plugin (`POST /api/plugins/install` runs `npm install --ignore-scripts` and reads `<package>/lamaste-plugin.json`), but Lamaste never imports the package — not the panel, and not an agent's plugin host if the package is installed there. Nothing is mounted under `/api/<name>/` (requests there answer `404`), no panel bundle is served, and no storage can be bound to it (`400`). A `panel` declaration on such an identity-only plugin is a manifest error (`400` on install). What takes effect is what the manifest declares: its `oidcClients` are written to Authelia on enable and removed on disable or uninstall, confidential-client secrets are minted and shown exactly as above, and its `capabilities` can be granted to agents. `GET /api/plugins` reports each plugin's `hosting`; a plugin installed before 4.2 is `"server"`.

The application's own tunnel (`feria.<domain>`) is created by the administrator as for any app; Lamaste does not create it from the manifest.

An agent-hosted plugin whose manifest also has an `agent` block has an _agent half_ the panel connects to: it can be hosted on an agent, which gives it an internal plugin tunnel, an installation secret and a forwarded admin API, and it may declare panel pages. See [Agent-Hosted Plugins](agent-hosted-plugins.md).

## Plugin OIDC client endpoints

### `GET /api/plugins/:name/oidc-clients`

Admin only. The clients a plugin declares, with whether they are served (plugin enabled) and, for confidential clients, when the secret was created and last rotated. Never the secret.

```json
{
  "clients": [
    {
      "id": "feria-ci",
      "name": null,
      "confidential": true,
      "grantTypes": ["client_credentials"],
      "scopes": ["registry_publish"],
      "audience": ["https://feria.{domain}"],
      "accessTokenClaims": [],
      "enabled": true,
      "secretCreatedAt": "2026-10-13T10:00:00.000Z",
      "secretRotatedAt": null
    }
  ]
}
```

### `POST /api/plugins/:name/oidc-clients/:clientId/rotate-secret`

Admin only, 10 per minute. Replaces a confidential client's secret in the store and in Authelia (restarted). The response is the only place the new secret appears.

```json
{
  "ok": true,
  "id": "feria-ci",
  "plugin": "feria",
  "secret": "…",
  "rotatedAt": "2026-10-13T11:00:00.000Z"
}
```

`400` for a public client, `404` for a client the plugin does not declare.

CLI: `lamaste-server plugins oidc-clients <name>` and `lamaste-server plugins rotate-secret <name> <clientId>`. Every `lamaste-server plugins` subcommand goes through the running panel — `install`, `enable`, `disable` and `uninstall` call the routes above, so a plugin the CLI installs is the one the panel serves and its clients reach Authelia — and `lamaste-server plugins list` shows each plugin's hosting.

## Registry credential endpoints

### `GET /api/registry-credential`

Admin only. What is configured — never a token.

```json
{
  "configured": true,
  "provider": "feria",
  "registryUrl": "https://feria.example.com",
  "scope": "@lamalibre",
  "auth": "oidc",
  "clientId": "lamaste-server",
  "owner": "ci:auth.example.com/lamaste-server",
  "configuredAt": "2026-10-13T10:00:00.000Z"
}
```

`{ "configured": false }` when none is set.

### `PUT /api/registry-credential`

Admin only, 10 per minute. Verifies the whole chain against the registry, then stores the credential at `/etc/lamalibre/lamaste/registry-credential.json` (0600). From then on the panel's own installs, update staging and agent-half pinning authenticate to `registryUrl` for `scope` with the service token (see In Plain English); a package published only there installs from the panel.

```json
{ "registryUrl": "https://feria.example.com", "auth": { "kind": "oidc" } }
{ "registryUrl": "https://feria.example.com", "auth": { "kind": "token", "token": "feria_…" }, "scope": "@lamalibre" }
```

- `auth.kind: "token"` — a long-lived Feria token. The registry's `/-/whoami` must report the `admin` scope (the broker route requires it).
- `auth.kind: "oidc"` — the panel's own service principal. The panel first makes sure Authelia carries the confidential client `lamaste-server` (grant `client_credentials`, `token_endpoint_auth_method: client_secret_basic`, scope `lamaste.registry` — defined under `identity_providers.oidc.scopes` —, audience = the registry URL without a trailing slash, RS256 JWT access tokens; secret in `oidc-clients.json`). It then obtains a JWT from Authelia's token endpoint (`grant_type=client_credentials&scope=lamaste.registry&audience=<registryUrl>`), posts it to `<registryUrl>/-/feria/login`, and checks that `/-/whoami` reports `admin`. If any step fails the client is removed again and the error says what is missing — typically that Feria's `auth.json` needs, on its `groups` issuer for `https://auth.<domain>` (audience `<registryUrl>`), a `workloads` rule granting the `admin` scope when the `client_id` claim (or `sub`, which carries the same value) is `lamaste-server`. Feria keys issuers by `iss` and the relay's users log in through the same Authelia, so the rule cannot be a second `rules` issuer; `workloads` needs Feria 0.3.2 or later.

Response: as `GET`. Errors: `400` (no admin scope), `502` (registry or Authelia refused or unreachable), `503` (no domain yet).

The Authelia call goes to `127.0.0.1:9091` with `X-Forwarded-Proto: https` and `X-Forwarded-Host: auth.<domain>`, which is how Authelia derives the issuer — the JWT says `iss: https://auth.<domain>`, exactly as it would through nginx. In the JWT, Authelia sets both `sub` and `client_id` to the client id for the client-credentials flow (there is no end user).

With `oidc`, the Feria token the panel obtains is cached in the panel process until five minutes before it expires, then obtained again. Changing or removing the credential drops it, and every agent's cached token.

### `DELETE /api/registry-credential`

Admin only. Removes the credential; with `oidc`, also removes the `lamaste-server` client from Authelia and deletes its secret.

```json
{ "configured": false, "removed": true }
```

### `GET /api/agents/me/registry-credential`

Agent certificates only; identity is the certificate label, never a parameter. Returns a read-only registry token owned by `agent:<label>`, valid for one hour, which the agent daemon writes to an isolated npm userconfig (`npm_config_userconfig`) for one `npm install` and deletes afterwards.

```json
{
  "registryUrl": "https://feria.example.com/",
  "scope": "@lamalibre",
  "token": "feria_…",
  "expiresAt": "2026-10-13T11:00:00.000Z",
  "tokenId": "7c1e…"
}
```

- The token is cached per agent until five minutes before it expires, so every install within the hour gets the same one.
- An agent may be issued at most **ten new tokens per hour**; beyond that the route answers `429` with `Retry-After` (seconds) and `retryAfterSeconds`. The per-IP limit (30 per minute) remains as a backstop.
- `403` for any other certificate — an admin certificate has no agent identity to broker for (plugin-agent certificates get `400`); `404` when no registry credential is configured (the agent installs from the public registry as before); `502` when the registry refuses.

CLI: `lamaste-server registry-credential show | set --url <registry> (--oidc | --token-stdin) | clear`. The token for `--token-stdin` is read from stdin (or `LAMASTE_REGISTRY_TOKEN`), never from an argument, and the CLI hands the request body to curl on stdin, so the token is not in curl's arguments either.

### Group changes

When a user loses a `feria-*` group, or is deleted, the panel asks the registry to revoke that user's tokens (`DELETE /-/feria/tokens?owner=user:<name>`) with the same credential. This is best effort — the user operation reports `warnings` rather than failing. The identity change feed planned for the identity directory (see [Identity directory design](../identity-directory-design.md)) will supersede this hook: plugins will subscribe to membership changes instead of the panel calling each registry.

## Related

- [Authentication (Authelia)](../01-concepts/authentication.md) — the OpenID Connect provider configuration
- [Configuration Files](../06-reference/config-files.md) — `registry-credential.json`, `oidc-clients.json`, `oidc-issuer.pem`
- [Installer](../03-architecture/installer.md) — how the issuer key is provisioned
