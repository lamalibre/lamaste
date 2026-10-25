# Multi-Domain Relay — Design Document

> **Status:** agreed 2026-10-25 (all nine decisions as recommended); implementation in progress. Target: Lamaste 4.7 (after 4.6, slice 7).
> **Pilot:** `codelama.com.tr` next to `samplepark.tr` on the relay `138.68.65.228`.
> **Companions:** `identity-directory-design.md` (the slice 6 directory this builds on),
> `gatekeeper-design.md`, `herd/docs/r730-workload-plan.md` §14 (why, and the live steps).

## Goal

One relay serves several **base domains**. A person has **one account** (one
password, one TOTP) in the relay's one directory, and reaches a domain only
when they are an explicit **member** of it.

- Code Lama's developers are members of `codelama.com.tr` and `samplepark.tr`.
- samplepark's users are members of `samplepark.tr` only, and never reach a
  `codelama.com.tr` application.
- Adding a customer domain changes nobody's access to any other domain.

## Settled (not reopened here)

- One relay, one user directory: one account, password and TOTP per person.
- An explicit member list per domain.
- A sign-in page (`auth.<domain>`) and an Authelia session cookie per domain.
- Membership is rendered into Authelia's `access_control` **and** checked
  again in Gatekeeper, which shows a refusal page instead of today's 401 login
  loop.
- `authenticated` means "member of this domain"; `restricted` plus Gatekeeper
  grants still narrows one application.
- Admin stays relay-wide (the mTLS admin certificate manages every domain).
  The panel (`panel.`) and chisel (`tunnel.`) stay on the primary domain.
- No per-domain external identity provider yet.
- The shared blast radius (one droplet, nginx, panel, Gatekeeper and Authelia
  for every domain) is accepted and documented, not engineered around.

## What exists today (4.6 base, `feat/app-plugins-slice7` `7211da5`)

| Piece                     | Single-domain assumption                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `panel.json`              | One `domain` (`server/daemon/src/lib/config.js` `ConfigSchema`). Every route that creates a hostname reads `getConfig().domain`.                                                                                                                                                                                                                                                                                                                                                |
| Tunnels                   | `createTunnelLocked` (`core/lib/src/server/tunnels.ts`) builds `fqdn = ${subdomain}.${domain}` and **stores** it. Uniqueness is by bare `subdomain` (`SUBDOMAIN_IN_USE`). The nginx writers (`NginxDeps`) take `(subdomain, domain, …)` and recompute the hostname; vhost files are `lamalibre-lamaste-app-<subdomain>` / `lamalibre-lamaste-agent-panel-<subdomain>`.                                                                                                          |
| Startup reconcile         | `expectedTunnelVhost` (`server/daemon/src/lib/vhost-reconcile.js`) already derives a tunnel's domain from its stored `fqdn` (`fqdn.slice(subdomain.length + 1)`); `reconcileSiteVhosts(log, config.domain)` renders the panel, auth and every site vhost with the one domain.                                                                                                                                                                                                   |
| Sites                     | `createSite` (`core/lib/src/server/sites.ts`): managed `fqdn = ${name}.${domain}`, custom `fqdn = customDomain`; `aliases` on custom sites. Collision checks rebuild tunnel hosts as `${t.subdomain}.${domain}` rather than reading `t.fqdn`. `createSite` does not refuse an `agent-` name (gap). Site vhosts are `lamalibre-lamaste-site-<uuid>`.                                                                                                                             |
| Web surfaces (slice 7)    | `createWebSurface` / `hostnameTaken` (`server/daemon/src/lib/web-surface.js`) build `${subdomain}.${config.domain}`.                                                                                                                                                                                                                                                                                                                                                            |
| User surfaces (slice 6)   | `userSurfaceHosts` (`core/lib/src/user-surface.ts`) works from stored `fqdn`s only — no domain involved.                                                                                                                                                                                                                                                                                                                                                                        |
| Reserved names            | `CORE_SUBDOMAINS = ['panel','auth','tunnel']`, `RESERVED_SUBDOMAINS` (+ `www`, `mail`, `ftp`, `api`), `AGENT_PANEL_SUBDOMAIN_PREFIX = 'agent-'` (`core/lib/src/constants.ts`); a copy in `server/ui/src/admin/lib/web-surface.js`.                                                                                                                                                                                                                                              |
| Authelia session          | `writeAutheliaConfig(domain, …)` (`core/lib/src/server/authelia.ts`) renders one `session.cookies` entry; `rewriteAutheliaConfig` already loops over the array.                                                                                                                                                                                                                                                                                                                 |
| Authelia `access_control` | `updateAccessControl(sites)` renders only per-site rules (allowed users, `group:admins`, deny); `default_policy: two_factor` — any Authelia user passes on every other host.                                                                                                                                                                                                                                                                                                    |
| nginx 401                 | Gatekeeper tunnel vhosts (`buildGatekeeperVhost`) and web-surface vhosts (`renderWebSurfaceVhost`) write `error_page 401 =302 https://auth.${domain}/?rd=…`. Static sites and the auth vhost use Authelia's own `$redirection_url`.                                                                                                                                                                                                                                             |
| Auth vhost                | `renderAuthVhost(domain)` (`server/daemon/src/lib/nginx.js`), file `lamalibre-lamaste-auth`, declares the http-level `limit_req_zone … zone=user_access_auth` and serves `/invite/`, `/api/invite/` and `/api/user-access/authorize`. No `X-Forwarded-Host` — Authelia sees `Host`.                                                                                                                                                                                             |
| Gatekeeper                | `authorizeTunnelRequest` (`sdks/gatekeeper/src/server/routes/authz.ts`): `public`/`authenticated` → allow any Authelia user; `validateWithAuthelia` maps **every** non-200 (Authelia's 403 too) to `null` → 401 → nginx sends the browser back to the sign-in page, which (already signed in) sends it back: a loop. Session cache keyed by host already.                                                                                                                       |
| OIDC                      | `buildOidcProviderSection(domain, …)` writes no issuer; Authelia derives it per request from `X-Forwarded-Host`/`Host` (`IssuerURL()` in Authelia's `internal/middlewares/authelia_context.go`, checked against 4.39.13; pinned 4.39.28). `{domain}` in a client's `audience`/`redirectUris` expands to the one domain (`expandDomain`). Clients carry `authorization_policy` `one_factor`/`two_factor` — Authelia's `access_control` does **not** apply to OIDC authorization. |
| Registry credential       | `registry-credential.json` stores no issuer; `obtainRegistryServiceToken` uses `autheliaIssuer(getConfig().domain)` (`server/daemon/src/lib/registry-credential.js` `oidcDeps`).                                                                                                                                                                                                                                                                                                |
| Certificates              | HTTP-01 per hostname via `lamaste-certbot`; a wildcard is only ever found. `issueTunnelCert` strips the first label to look for `*.<base>`; `getCertPath(fqdn, domain)` is called with `config.domain`.                                                                                                                                                                                                                                                                         |
| `lamaste-priv`            | `PANEL_SITE_RE` accepts `panel-domain`, `auth`, `tunnel`, `app-<label>`, `agent-panel-<label>`, `site-<uuid>` — **no dots**, so no name containing a hostname.                                                                                                                                                                                                                                                                                                                  |
| Agents                    | Chisel and converge depend only on ports and `https://tunnel.<enrolled domain>:443` (`assertRelayServerUrl`, `enrolledDomain`). `agent-config` returns `{port, subdomain}` per tunnel. `lamaste-agent status` prints `${t.subdomain}.${config.domain}` — wrong for a tunnel on another domain.                                                                                                                                                                                  |
| Invitations, user access  | Invite URL `https://auth.${config.domain}/invite/<token>`; desktop user login opens `auth.<d>` and exchanges at `panel.<d>` for the same `d` (`user_access.rs`).                                                                                                                                                                                                                                                                                                                |

## Model

### Domain records

`state.db` migration `0016_domains.sql`:

```sql
CREATE TABLE domains (
  name        TEXT PRIMARY KEY,            -- 'codelama.com.tr', lower case
  is_primary  INTEGER NOT NULL DEFAULT 0,  -- exactly one row = 1
  status      TEXT NOT NULL CHECK (status IN ('pending','active')),
  created_at  TEXT NOT NULL,
  activated_at TEXT
);
CREATE UNIQUE INDEX domains_one_primary ON domains(is_primary) WHERE is_primary = 1;
```

- The migration inserts the primary from `panel.json` `domain` (status
  `active`) when onboarding is completed; onboarding inserts it otherwise.
  `panel.json` `domain` stays as the primary's name, so everything that means
  "the panel's domain" (CORS, `panel.`, `tunnel.`, agent-config, agent panels,
  desktop user access, 2FA) keeps reading it unchanged.
- **Domains never nest**: a new domain may not equal, contain or be contained
  in another (`a.samplepark.tr` beside `samplepark.tr` is refused). A browser
  sends a parent domain's cookie to every host under it, so nesting would
  mix two domains' sessions.
- Core `domains.ts` (root export, pure): `assertDomainName` (two or more
  labels, `HOSTNAME_REGEX`, no wildcard, lower case), `domainsOverlap`,
  `domainOfHost(host, domains)` — the one domain the host equals or is under,
  else `null`.

**The domain of a hostname is derived from the hostname**, never stored a
second time. Tunnels and sites already store `fqdn`; because domains never
nest, `domainOfHost(fqdn)` is unambiguous. A stored second field could only
disagree with the hostname.

### Hostnames

| Object                         | Hostname                                                      | Domain                                      |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------- |
| App / plugin tunnel            | `<subdomain>.<domain>` (`domain` in the API, default primary) | chosen at creation                          |
| Agent panel tunnel             | `agent-<label>.<primary>`                                     | always primary (mTLS, admin/agent only)     |
| Managed site                   | `<name>.<domain>`                                             | chosen at creation                          |
| Custom site                    | `customDomain`                                                | `domainOfHost(customDomain)`, may be `null` |
| Site alias                     | as given                                                      | none of its own — a 301 to the site         |
| User-surface binding (slice 6) | the bound tunnel's `fqdn`                                     | the tunnel's; must be the plugin's domain   |
| Web surface (slice 7)          | `<subdomain>.<plugin's domain>`                               | the plugin's                                |
| `panel.`, `tunnel.`            | primary only                                                  |                                             |
| `auth.`                        | one per active domain                                         |                                             |

Changes in core and serverd:

- `createTunnel` takes `domain` and validates it against the active domains;
  uniqueness becomes **by `fqdn`** (`feria.samplepark.tr` and
  `feria.codelama.com.tr` may coexist). `sites.ts` collision checks and
  `validateAliases` read stored `t.fqdn` instead of rebuilding
  `${t.subdomain}.${domain}`; `createSite` refuses an `agent-` name (closes
  today's gap).
- The `NginxDeps` writers take `fqdn` instead of `(subdomain, domain)`;
  `nginx.js` derives the Authelia host from it (`auth.${domainOfHost(fqdn)}`).
  `getCertPath` / `hasWildcardCert` are called with the host's domain, not
  `config.domain`.
- `reconfigureTunnelLocked`, `rewriteServedRoutes`, `bindUserSurface`,
  `web-surface.js` (`hostnameTaken`, `createWebSurface`, `renderOwnedSite`,
  `reconcileOwnedSiteVhost`, `moveWebSurfaceFromTunnel`) and
  `reconcileSiteVhosts` stop taking `config.domain` for hostnames.
- `agent-config` tunnels gain `fqdn`; `lamaste-agent status` prints it.
- Moving an existing tunnel to another domain is **not** in this feature
  (decision 6): delete and re-create.

### Reserved names per domain

On **every** domain: `RESERVED_SUBDOMAINS` (`panel`, `auth`, `tunnel`, `www`,
`mail`, `ftp`, `api`) and the `agent-` prefix. `panel.` and `tunnel.` are not
served on added domains, but reserving them keeps every domain's namespace the
same and leaves room. A domain's apex is no relay host: it may be a custom
site (the company page may later move to the relay) or a site's alias, as
may `www.<domain>`; `isRelayHost` (`panel.`, `auth.`, `tunnel.`, `agent-*`)
is what custom sites and aliases may never take. Site **names** stay unique
relay-wide (agents' `allowedSites` and the CLI name sites by them), so a
second `blog.` on another domain is a custom site there. The UI's copy of the list
(`server/ui/src/admin/lib/web-surface.js`) is replaced by the core export.

### Vhost files named by full hostname

| Today                                                                    | New                                    |
| ------------------------------------------------------------------------ | -------------------------------------- |
| `lamalibre-lamaste-app-<subdomain>`                                      | `lamalibre-lamaste-app-<fqdn>`         |
| `lamalibre-lamaste-agent-panel-<sub>`                                    | `lamalibre-lamaste-agent-panel-<fqdn>` |
| `lamalibre-lamaste-auth`                                                 | `lamalibre-lamaste-auth-<domain>`      |
| `lamalibre-lamaste-site-<uuid>`, `-panel-domain`, `-tunnel`, `-panel-ip` | unchanged                              |

- `lamaste-priv` `PANEL_SITE_RE` gains `app-<host>`, `agent-panel-<host>`,
  `auth-<host>` with `HOST` = the lower-case hostname rule it already applies
  to `server_name`, and keeps accepting the legacy names for `remove`/`disable`
  only (`LEGACY_SITE_RE`). The `lamaste-priv` test checks both.
- **Migration** at serverd start, in `vhost-reconcile.js`, before the panel
  listens: for each tunnel and the auth vhost, if the legacy file exists and
  the new one does not, write the new file with the same link state, remove
  the legacy file and link, then one `nginx -t` + reload; a failing `nginx -t`
  restores the legacy files. Idempotent; logged as one line per file.
- Ordering: create-lamaste's redeploy installs `lamaste-priv` before serverd
  starts, so the relay update (Panel Update = redeploy) brings the new
  allow-list first. A serverd that finds a `lamaste-priv` without the new
  names (refused write) keeps the legacy names and logs an error.
- The auth vhost's http-level `limit_req_zone user_access_auth` stays only in
  the **primary** auth vhost, with `/api/user-access/authorize`: desktop user
  access is primary-only (the desktop exchanges at `panel.<d>` for the same
  `d`). Added domains' auth vhosts carry `/`, `/invite/` and `/api/invite/`.

## Authelia

### Session cookies

One `session.cookies` entry per **active** domain, same `name`
(`authelia_session` — browsers scope cookies by domain, and every Lamaste
reader strips or parses by name, `authelia-session.ts`):

```yaml
session:
  cookies:
    - domain: samplepark.tr
      authelia_url: https://auth.samplepark.tr
      default_redirection_url: https://samplepark.tr
    - domain: codelama.com.tr
      authelia_url: https://auth.codelama.com.tr
      default_redirection_url: https://codelama.com.tr
```

Core `renderSessionCookies(domains)` (pure); `updateAuthelia…` writes it
through `rewriteAutheliaConfig`. Authelia picks a cookie domain by suffix of
the target host (`GetCookieDomainFromTargetURI`) and only redirects to a target
inside a configured cookie domain (`IsSafeRedirectionTargetURI`), so each
domain's sign-in sets and reads its own cookie. A developer signs in once per
domain, with the same password and TOTP. (WebAuthn credentials would be per
domain — Lamaste uses TOTP only.)

### `access_control`

Authelia evaluates rules in order and applies the first that matches, so a
member gate cannot be a rule placed "before" the per-site rules; it has to be
**inside** them. `renderAccessControl(domains, members, sites)` (core, pure)
replaces `updateAccessControl`'s rule building:

1. **Per protected site** (as today), every subject ANDed with membership of
   the site's domain: `allowedUsers ∩ members(domain)` as `user:` subjects;
   the admins clause becomes `[['group:admins', 'user:<m>'] for m in members]`
   (AND in Authelia's subject syntax — an admin who is a member). Then `deny`.
2. **Per domain**: `domain: [<d>, '*.<d>']`, `policy: two_factor`,
   `subject: ['user:<m>' for m in active members]`; then
   `domain: [<d>, '*.<d>']`, `policy: deny`. A domain with no members
   renders only the deny.
3. `default_policy: deny` (today `two_factor`). Every host the relay gates is
   under a domain; a host under none (a custom site outside every domain)
   cannot hold a session cookie anyway, so this only closes what was
   accidentally open.

Members are rendered by **username** (Authelia's subject), active users only
(a disabled or removed user is absent). Rendering is called from
`changeUsers` (after the directory settles, before the Authelia restart it
already does), from every membership change, from site changes (core `sites.ts` calls its
`renderAccess` dependency with the sites it saves) and at start. One `rewriteAutheliaConfig` per
change; unchanged output = no restart.

Membership is **not** rendered as Authelia groups in `users.yml` (decision
8): groups would reach every application in `Remote-Groups` and the OIDC
`groups` claim (Feria sees groups), and `users.yml` is a file Authelia's
password reset rewrites — the directory would keep a second copy of
membership.

### `auth.<domain>` vhost and certificate

`renderAuthVhost(domain, { primary })`: the same Authelia proxy as today,
`server_name auth.<domain>`, certificate `auth.<domain>` (HTTP-01). Written
when a domain is activated, removed when it is removed.

## Membership in the directory

`0016_domains.sql` also creates:

```sql
CREATE TABLE domain_members (
  domain   TEXT NOT NULL REFERENCES domains(name),
  user_id  TEXT NOT NULL REFERENCES directory_users(user_id),
  added_at TEXT NOT NULL,
  added_by TEXT NOT NULL,          -- actor, as audit rows name it
  seq      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (domain, user_id)
);
```

- A trigger stamps `seq` from `directory_counter` on insert (as
  `plugin_audience_stamp_insert`), and a delete trigger bumps the counter, so
  membership changes are ordered in the directory's one sequence.
- Audit: `directory.membership.added` / `directory.membership.removed`
  (`{ domain, userId, reason }` — no username), `domain.added`,
  `domain.activated`, `domain.removed`.
- Keyed by `user_id`: a re-created username is a new user with no membership.
- **Offboarding** (`offboardUserUnlocked`): `deleted` removes every
  membership (reason `deleted`); erasure finds none left. **Disable keeps
  memberships** (decision 2) — a disabled user is excluded from every
  rendering at once, and enabling restores exactly what they had.
- Losing membership of the domain the registry credential names also revokes
  that user's registry tokens (`revokeUserRegistryTokens`), as losing a
  `feria-*` group does.
- **New users** (decision 1): while the relay has one domain, every creation
  path (users API, invitation accept, onboarding, a user adopted from
  `users.yml` by `reconcileDirectory`) adds membership of it — a single-domain
  relay behaves as today. With two or more domains, the users API and
  invitations name the domains (`domains: [...]`, at least one); a user
  adopted from `users.yml` gets none until an admin adds one.
- Invitations carry `domains`; accepting adds them in the same `changeUsers`;
  the link is `https://auth.<first domain>/invite/<token>`.
- **Plugin audiences** (slice 6): a plugin belongs to one domain (below); its
  audience is the entitled users who are members of it. A member leaving
  becomes `remove/unentitled` — no new reason, so 4.5 agent halves need no
  change.

## Gatekeeper

Gatekeeper reads a projection the panel writes, `domains.json` (0600
`lamaste`, atomic, in the data dir, watched like `tunnels.json`):

```json
{ "v": 1, "domains": [{ "name": "codelama.com.tr", "members": ["onur", "…"] }] }
```

Active domains, active members, usernames (Authelia's answer names a
username). Written in the same places as the Authelia rendering, before the
Authelia restart.

In `authenticatedSession` (every route: tunnel, user surface, shell):

1. Authelia **403** is no longer "unauthenticated": `validateWithAuthelia`
   returns `{ kind: 'forbidden' }` and the route answers 403 with the
   **domain refusal page** (user-surface API: JSON `{error:'not_a_member'}`).
   401 stays for no/bad session.
2. After Authelia's 200, `domainOfHost(host)` and membership of the
   username are checked against `domains.json`; not a member → the same 403.
   A host under no domain, or a missing/unreadable projection → 403 (fail
   closed).
3. Then the access mode, as today (`restricted` → grants).

The refusal page (`templates.ts` `buildDomainRefusalPage(domain, options)`)
says the account is not a member of `<domain>`, names the admin contact from
Gatekeeper's settings, and links to `https://auth.<domain>/logout` to sign in
as someone else. It names no username (Authelia's 403 carries none).
nginx already serves Gatekeeper's 403 body inline on tunnel and web-surface
vhosts (`error_page 403 = /internal/lamaste/authz`, `…/shell-authz`); static
Authelia-protected sites, which ask Authelia directly, gain an
`error_page 403` location that asks Gatekeeper for the page
(`GET /authz/refusal/:fqdn`, no session needed, nothing but the page).

The session cache key already includes the host; membership changes bust
it (`bustCachedSessions`, as group/grant writes do).

## OIDC: one issuer per domain

- Authelia derives the issuer from the request host, so
  `https://auth.codelama.com.tr` is an issuer as soon as its auth vhost
  exists; nothing in the OIDC section names an issuer. Every client is known
  to every issuer (Authelia has no per-host client list): a token for a
  client obtained at the wrong issuer carries that issuer's `iss`, which a
  relying party that trusts one issuer (Feria) refuses.
- **A plugin belongs to one domain** (decision 5): `plugins.domain`
  (migration 0016, default primary). It determines `{domain}` expansion in its
  OIDC clients' `audience`/`redirectUris`, which tunnels may be bound as its
  user surface, its web surface's domain, and its audience. Changing it is
  refused while a surface is bound.
- **Membership for OIDC**: Authelia's `access_control` does not apply to OIDC
  authorization; a client's `authorization_policy` does. For each domain with
  user-facing clients, render `identity_providers.oidc.authorization_policies`
  `lamaste-<n>-one_factor` / `-two_factor` (`default_policy: deny`, one rule
  with the factor and the members as `user:` subjects), and point each
  user-facing client at its domain's policy of its declared factor. Pure
  `client_credentials` clients (no user) keep `one_factor` (Authelia 4.39
  refuses anything else). `feria login` therefore admits only members of
  Feria's domain.
- **Registry credential**: `registry-credential.json` gains `issuerDomain`
  (absent = primary, written on the next save); `oidcDeps` uses it for
  `X-Forwarded-Host`, `feriaRulesHint` names it, and `PUT` takes it
  (`--issuer-domain` in the CLI). The owner Feria records becomes
  `ci:auth.<issuerDomain>/lamaste-server`.
- **Feria move (§14.9)**, once released: install/move Feria's plugin domain to
  `codelama.com.tr`, delete/re-create its tunnel there, update Feria's
  `auth.json` (issuer `https://auth.codelama.com.tr`, audience
  `https://feria.codelama.com.tr`, workloads rule), re-register the
  credential with `issuerDomain: codelama.com.tr`. Lamaste needs nothing more.

## Domain lifecycle (panel API)

All admin-only (mTLS), new reserved API prefix `domains`:

| Route                                                                    | Does                                                                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/domains`                                                       | domains with status, member count, what uses each (tunnels, sites, plugins)                                                                                         |
| `POST /api/domains {name}`                                               | adds `pending` (validation, no nesting)                                                                                                                             |
| `POST /api/domains/:name/verify-dns`                                     | `auth.<d>` resolves to the relay IP; reports whether a wildcard probe (`test-lamaste-check.<d>`) does                                                               |
| `POST /api/domains/:name/activate`                                       | issue `auth.<d>`, write its vhost, add the session cookie, render `access_control`/OIDC policies and `domains.json`, restart Authelia — one operation with rollback |
| `DELETE /api/domains/:name`                                              | refused for the primary and while any tunnel, site or plugin uses it (409 `domain_in_use`); removes memberships (reason `domain-removed`), cookie, vhost            |
| `GET /api/domains/:name/members`                                         | `[{ userId, username, status, addedAt }]`                                                                                                                           |
| `PUT` / `DELETE /api/domains/:name/members/:user` (`userId` or username) | add / remove one member                                                                                                                                             |

Plus: `domain` on `POST /api/tunnels`, `POST /api/sites` (managed),
`POST /api/plugins/:name/web-surface`; `PUT /api/plugins/:name/domain`;
`domains` on `POST /api/users` and invitations; `GET /api/users` adds each
user's `domains`.

## Panel UI, desktop, CLI

- **Panel**: a Domains page (add, DNS check with the records to create, activate,
  remove, members); a domain picker on tunnel/site/web-surface creation
  (hidden while there is one domain); domain chips and an editor on the
  Users page; domains on invitations; the plugin card shows and changes the
  plugin's domain; hostnames everywhere from stored `fqdn`.
- **AdminClient** (`core/lib/src/types.ts`): `getDomains`, `addDomain`,
  `verifyDomainDns`, `activateDomain`, `removeDomain`, `getDomainMembers`,
  `addDomainMember`, `removeDomainMember`, `setPluginDomain`; the web client
  (`web-admin-client.js`) and the desktop client (`desktop-admin-client.js`,
  `admin_*` commands in `admin_commands.rs`) implement them — enforced at
  build time as today.
- **CLI** `lamaste-server`: `domains list|add|verify-dns|activate|remove`,
  `domains members <d> [add|remove <userId|username>]`, `--domain` on
  `tunnels create`, `sites create`, `plugins web-surface create`,
  `plugins domain <name> [<d>]`, `users create --domains`; `status` lists the
  domains. `lamaste-agent status` prints `fqdn`.

## Upgrade in place

A single-domain relay on 4.6 upgrades with no change in behaviour:

1. Migration 0016: the primary domain row; **every non-removed directory user
   becomes a member** (`added_by: 'migration'`); every plugin's domain = primary.
2. Start-up: vhosts renamed (above); Authelia rendering gains the
   one-domain rule (members = everyone) and `default_policy: deny`;
   `domains.json` written. Every host was reachable by every Authelia user and
   still is; nothing else changes.
3. The registry credential keeps working (absent `issuerDomain` = primary).
4. Agents: nothing (ports and `tunnel.<primary>` unchanged). Old agents
   ignore the new `fqdn` field in `agent-config`.

## Security notes

- The member gate is enforced twice, from one source (`state.db`): Authelia
  (rendered allow-lists, deny last, default deny) and Gatekeeper (projection).
  Either alone keeps a non-member out of tunnels and user/web surfaces;
  static sites rely on Authelia; OIDC on the client's authorization policy.
- Cross-domain cookies: domains never nest, so a session cookie of one domain
  is never sent to another's hosts; the backend cookie map strips
  `authelia_session` by name on every domain.
- Same-site isolation between applications on one domain is unchanged
  (slice 7's deferred note: a customer's shells on its own registrable domain
  is now possible).
- Logs and audits name domains and `userId`s, never usernames.

## Proof (rodeo)

`setup-host.sh`'s dnsmasq gains `address=/<domain>/<host ip>` for
`TEST_DOMAIN_2` and `TEST_DOMAIN_3`; `setup-visitor.sh` adds `auth.` and the
test hostnames of each to `/etc/hosts`; the certbot shim already signs any
name. Specs (written after slice 7's campaign, run only with the user's go;
what wave 4 wrote, with two splits — 48 and single-VM 35 — is under Waves):

- **three-VM 45 — developer on two domains**: domain B added and activated;
  user `dev` member of A and B: signs in at `auth.A`, reaches an
  `authenticated` tunnel on A; on B is sent to `auth.B`, signs in with the same
  password and TOTP, reaches B's tunnel; a `restricted` tunnel on B without a
  grant → access-request page; with a grant → through.
- **three-VM 46 — customer on one domain**: user `cust` member of B only:
  B's tunnel works; A's `authenticated` tunnel, A's static site, A's user
  surface → domain refusal page (403, no login loop); `feria`-style OIDC
  device login for A's client refused, for B's admitted; removing `cust`
  from B → refused within one render; deleting `cust` removes every
  membership (audit).
- **three-VM 47 — a third domain added**: snapshot of A's and B's
  `access_control` rules, `domains.json` members and reachability matrix;
  add and activate C with a new member; A and B unchanged (rules byte-equal
  apart from C's own, every earlier request answers as before).
- **single-VM 34 — upgrade and renames**: legacy-named vhosts planted, serverd
  restarted: renamed with link state kept; one domain, all users members,
  every host answers as before; `lamaste-priv` refuses a dotted name it does
  not know and the legacy names for `write`.

## Waves

1. **Core** — done: `domains.ts` (`assertDomainName`, `domainsOverlap`,
   `assertDomainAddable`, `domainOfHost`, `isReservedLabel`, `isRelayHost`),
   `domains` reserved API prefix, the pure renderers `renderSessionCookies`,
   `renderAccessControl`, `renderOidcAuthorizationPolicies`
   (`OIDC_USER_FACTORS` shared with the manifest schema), tunnel and site
   uniqueness by stored `fqdn`, one reserved-label rule for tunnels, sites
   and web surfaces, `issuerDomain` on the registry credential
   (`registryIssuer`); tests in serverd `multi-domain-core.test.js`. The
   renderers are wired, and `updateAccessControl`'s own site loop removed,
   in wave 2 together with membership — wiring them alone would deny every
   user. `NginxDeps` by `fqdn` moves to wave 2 with `nginx.js`.
2. **serverd + Gatekeeper + lamaste-priv** — done. state.db `0016_domains.sql`
   (`domains`, `domain_members` with seq triggers, `plugins.domain`);
   `lib/domains.js` (records, `ensurePrimaryDomain`, membership,
   lifecycle with rollback, `syncDomainAccess` rendering Authelia and the
   `domains.json` projection), `lib/plugin-domain.js`, routes
   `routes/management/domains.js`; the directory gives new users their
   domains and ends a removed user's memberships in its transaction;
   `changeUsers` renders before Authelia restarts; audiences are entitled ∩
   members; OIDC clients carry their plugin's domain; vhosts by hostname
   with `renameLegacyVhosts` at start; per-domain auth vhosts; Gatekeeper
   (`authz.ts`: Authelia 403 kept, projection check, `buildDomainRefusalPage`,
   `/authz/refusal/:fqdn`); `lamaste-priv` names. Tests: serverd
   `domains.test.js`, `multi-domain-core.test.js`, Gatekeeper
   `authz-domain-membership.test.js`, and the existing suites updated.

   **Deviations, for review:**
   - OIDC authorization policy names are `lamaste_<domain with . as _>_<factor>`,
     not `lamaste:<domain>:<factor>`: Authelia's configuration loader
     (koanf) splits key paths at dots. Domain labels hold no `_`, so the
     names stay unambiguous.
   - A web surface is created on its plugin's domain (decision 5); its
     create request takes no `domain` (one would only have to equal it).
     Moving the plugin (`PUT /api/plugins/:name/domain`) is refused while a
     tunnel is bound as its user surface or it owns a web surface
     (409 `surface_bound`).
   - `plugins.domain` NULL means the primary; nothing is rewritten at the
     upgrade. A plugin is installed on the primary and moved afterwards.
   - Sign-in on a hostname under no domain is refused when a site is
     created or protected (`NOT_UNDER_DOMAIN`, 400): no session cookie
     reaches it. Such a site's rules render a deny alone.
   - A static site's refusal page (`/authz/refusal/:fqdn`) cannot tell a
     non-member from a user the site's own list leaves out (Authelia's 403
     says neither): it says both.
   - Members may be added to a pending domain, so an activation goes live
     with them; pending domains are rendered nowhere.
   - `changeUsers` skips its own Authelia restart when the domain rendering
     restarted it already (one restart per change).
   - An agent with `tunnels:write` may create (restricted) tunnels on any
     active domain, as on the primary before.
   - `renameVhosts` (nginx.js) is unit-tested through its caller only —
     nginx.js reads `/etc/nginx`; the rename itself is proven by single-VM
     spec 34.

   **After review (`/simplify`):** one writer of what members may do —
   `withDomainRendering` in `lib/domains.js` holds the lock under which
   Authelia's domain access, the projection and the OIDC provider are
   written, each reading the members inside it (before, the OIDC provider
   could write back policies from an older read; `domains.test.js` proves
   the order). `authenticated` and `restricted` tunnels share one vhost
   writer (`writeGatekeeperVhost`): their vhosts are identical, Gatekeeper
   decides by the access mode. A removed domain's `auth.` vhost goes with a
   test and reload. Shared helpers: core `labelUnder`, `hostnameHolder`,
   `DomainNameSchema`, `resolveHostA`, `registryIssuerDomain`,
   `atomicWriteJSONIfChanged`, `indexDomainsProjection` (Gatekeeper indexes
   the projection once); daemon `sendFailure` (lib/app-error.js),
   `domainOfHostname`, `invitationSignInDomain`, `domainsOverview`.
   `domainsForNewUser(…, { required })` answers `domains_required`.
   Onboarding writes Authelia's first configuration with the administrator
   as the primary's member, so Authelia starts once. The dead
   `syncAllAccessControl` is gone; sites' `AutheliaDeps.updateAccessControl`
   is `renderAccess`.

3. **UI, desktop, CLI, docs** — done. `AdminClient` gains `getDomains`,
   `addDomain`, `verifyDomainDns`, `activateDomain`, `removeDomain`,
   `getDomainMembers`, `addDomainMember`, `removeDomainMember`,
   `setPluginDomain`, `domain` on tunnel/site creation, `domains` on users
   and invitations (`AdminUser.domains`); web client, desktop client and
   nine `admin_*` Tauri commands (domain names and user ids checked before
   curl; `admin_create_user`/`admin_create_invitation` now pass the panel's
   refusal through so `domains_required` reaches the form). Panel: a Domains
   page (web `/domains`, desktop server section) with DNS records to create,
   activation, members and removal showing `usedBy`; `DomainPicker` on
   tunnel and managed-site creation and `DomainMembershipChoice` on user
   creation, editing and invitations — both hidden on a one-domain relay;
   domain chips on Users; `PluginDomain` on the plugin card; tunnels listed
   by `fqdn`. UI helpers `admin/lib/domains.js` with tests; the UI's
   reserved-label copy is kept equal to core's by a test (the browser bundle
   does not carry the core library; `@lamalibre/lamaste` is a dev dependency
   of the UI for that test). CLI `lamaste-server domains
list|add|verify-dns|activate|remove|members`, `plugins domain`,
   `--domain` on `tunnels create`/`sites create`, `registry-credential set
--issuer-domain`, domains in `status`. Docs: `04-api-reference/domains.md`,
   `02-guides/second-domain.md`, and the multi-domain sections of users,
   tunnels, sites, registry-and-oidc, gatekeeper, overview, dns-and-domains,
   authentication, authorization, security-model (the shared blast radius)
   and nginx-configuration; CHANGELOG; CLAUDE.md.

   **After review (`/simplify`):** the rules are answered by the panel and
   core, never re-derived by a client — the UI imports reserved names and
   ports from the browser-safe `@lamalibre/lamaste/domains` subpath (a real
   dependency; no copy, no sync test); the desktop passes names through
   (`url_encode`) and lets the panel refuse; `GET /api/domains` answers
   `newUsersNeedDomains`; `domainsForNewUser` refuses an explicit empty list
   (new users on a multi-domain relay start with no domain chosen);
   `PUT /api/users/:username` takes `domains` and `setUserDomains` applies
   the difference in one transaction (the UI sends one request); `verify-dns`
   returns the records with their purpose; plugin views carry the resolved
   domain name (`withPluginDomains`; `plugins.domain` NULL stays the stored
   form); members are named by id or username in the members path. UI: one
   `useMembershipChoice` hook, `DomainPicker` owns '' = primary, the shared
   `Dialog.jsx` confirm instead of `window.confirm`, narrow invalidation.
   CLI: one `call`, a table of domain subcommands, a shared `fail`,
   `status` asks the panel in parallel with a short timeout and only while
   it runs. Web surfaces take their plugin's domain (wave 2's deviation), so
   no picker is offered for them.

   **Deviation:** the CLI has no `users create` (users are created in the
   panel or by invitation), so there is no `users create --domains`; domains
   of a new user are set in the panel or with `domains members … add` after
   it is created.

4. **Rodeo specs** — written, not run (they wait for the user's go). In
   `packages/tools/lamaste-rodeo`:
   - **Infrastructure.** B and C are `test_domain_n <primary> second|third`
     (`tests/e2e/test-domains.sh`: the first label replaced —
     `test.lamaste.local` → `second.lamaste.local`, `third.lamaste.local`),
     the one rule, sourced by `setup-host.sh` (both suites: dnsmasq answers
     the primary and the second, the three-VM host the third too),
     `setup-visitor.sh` (`auth.` of each in `/etc/hosts` and the cloud-init
     template) and `helpers.sh`, and shipped to the VMs as a tier asset. No
     tier or test variable: the tier runner injects only `HOST_IP` and
     `TEST_DOMAIN`. The specs make sure of the DNS again (`md_dns`,
     `local_domain_dns`) — a VM restored from an older snapshot predates it.
     Shared helpers: `tests/e2e/helpers.sh` (`vhost_name` /
     `vhost_available` / `vhost_linked`, `AUTHELIA_CONFIG_JSON` and
     `AUTHELIA_RULES_UNDER`, `start_stub_registry` — now used by 26, 27, 28 and
     35 — and the single-VM `local_sign_in`, `local_reset_totp`,
     `local_wait_authelia`, `local_domain_dns`) and
     `tests/e2e-three-vm/multi-domain-harness.sh` (on top of
     `app-plugin-harness.sh`, whose preflight is split into `relay_preflight`
     and the app-plugin checks, whose `host_api_call` takes `API_TIMEOUT`, and
     whose `sign_in` takes the sign-in page's domain). A user signs in again
     within the same 30 s TOTP step only after waiting for the next one
     (tracked per user); a fresh secret needs no wait. Membership is read
     from `GET /api/domains/:name/members`; Gatekeeper's projection only where
     its own check is the point.
   - **three-VM 45 — a developer on two domains**: B added, DNS checked
     (`auth.B` the one required record), activated, two session cookies; the
     developer in both domains' rules and projections; signed in at `auth.A`,
     A's tunnel; B's tunnel sends them to `auth.B` (with A's session too);
     signed in there with the same password and TOTP secret, B's tunnel; a
     restricted tunnel on B: the access-request page, then through with a
     grant.
   - **three-VM 46 — a customer on one domain**: members of B only reach B;
     signed in at `auth.A`, A's authenticated tunnel and A's
     Authelia-protected static site answer the domain refusal page (403, no
     `Location`); Gatekeeper's own check — the projection held without the
     customer (immutable, `chattr +i`, so the panel's once-a-minute render
     cannot undo it) refuses them while Authelia still admits them; no
     projection (a directory in its place: the panel's rename fails,
     Gatekeeper reads none) refuses everyone; restored, they are let in;
     every wait is `AUTHZ_SETTLE_SECONDS` (nginx keeps an authorization's
     200 for 10 s); removed from B and signed in at `auth.B` again (the
     removal restarted Authelia), the refusal page — audited by id; deleted,
     every membership ends, audited `directory.membership.removed` reason
     `deleted`, by directory id only.
   - **three-VM 47 — a third domain**: snapshot of A's and B's rendered
     rules, their member lists and a reachability matrix (one visitor call);
     C added and activated with a member and a tunnel; A's and B's rules
     byte-equal, their member lists unchanged, every request of the matrix
     answers as before (signed in again — C's activation restarted
     Authelia); C's member reaches C only; A's session is sent to `auth.C`.
   - **three-VM 48 — a plugin's user surface** (split from 46: installing and
     hosting an app plugin alone takes minutes, and rodeo ends a spec at ten):
     a member of A with a role reaches the agent half; a customer of B,
     signed in at `auth.A`, gets 403 JSON `{error: "not_a_member"}`, no
     redirect; the plugin cannot move to B while served on A (409
     `surface_bound`).
   - **single-VM 34 — upgrade and renames**: an enabled and a disabled
     tunnel and the auth portal put back under their 4.6 names; the panel
     restarted renames them with link state kept, no legacy name left,
     `nginx -t` passes, every host answers as before; one domain, the
     primary, every user its member, `newUsersNeedDomains` false;
     `lamaste-priv` refuses `write` for a 4.6 name and for an unknown dotted
     name — for the name (`site name not allowed for write`), as three-VM 01
     now asserts its content refusal names the directive. This is the nginx side of the rename that has no unit test.
   - **single-VM 35 — OIDC sign-in by membership** (moved from 46: the
     stand-in registry and fixture-plugin setup of spec 26 is single-VM; an
     authorization-code client, not device code, because Authelia's
     authorization endpoint answers a refused subject at once with
     `error=access_denied` to the redirect URI, where a device-code flow
     needs a browser to approve): the client belongs to A and points at A's
     two-factor policy; signed in at `auth.A`, the developer's authorization
     request goes on, the customer's is refused; the plugin moved to B, the
     client points at B's policy and the customer's request at `auth.B` goes
     on; `auth.A` and `auth.B` are issuers of their own.
   - **Existing specs updated** for the vhost names of wave 2 (by full
     hostname): single-VM 04 and 19, three-VM 01 (lamaste-priv's content
     check now under a valid name — a 4.6 name is refused before the
     content is read), 03, 15, 22, 32 and 43.

## Decisions (agreed 2026-10-25)

The user agreed to every recommendation below; the alternatives are kept for the record.

1. **New users on a one-domain relay** are made members of that domain
   automatically; with two or more domains they must be given domains.
   _Recommended_ — keeps single-domain relays as they are. Alternative:
   always explicit, every user creation names domains.
2. **Disable keeps memberships**; delete removes them. _Recommended_ — a
   disabled user is already excluded everywhere; enable restores. Alternative:
   disable removes them (the plan's §14.3 wording), and enable needs them
   re-added.
3. **Authelia's `admins` group needs membership too**: admins get no domain
   they are not a member of; inside a domain they keep bypassing `restricted`
   grants. _Recommended_ — explicit everywhere. Alternative: `admins` are
   implicit members of every domain.
4. **`default_policy: deny`** in Authelia from the upgrade on.
   _Recommended_ — fail closed. Alternative: keep `two_factor`.
5. **A plugin belongs to one domain** (OIDC clients, user and web surfaces,
   audience). _Recommended_. Alternative: per-client domains — no current
   plugin needs it.
6. **No tunnel move between domains** in this feature; Feria's move is delete
   - re-create (public tunnel, no grants lost). _Recommended_ — keeps scope;
     a move operation can come later.
7. **Domain derived from the hostname** (no stored `domain` field), with
   domains forbidden to nest. _Recommended_.
8. **Membership rendered as user subjects in `configuration.yml`**, not as
   Authelia groups in `users.yml`. _Recommended_ (no group leak to
   applications, one copy of membership).
9. **Version 4.7.0**, released after 4.6.0. _Recommended_.
