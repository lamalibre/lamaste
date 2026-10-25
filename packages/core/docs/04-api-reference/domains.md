# Domains API

> The relay's base domains and who is a member of each — one relay, one user directory, a sign-in and a member list per domain.

## In Plain English

A relay serves one **primary** domain (the panel's, set at onboarding) and any number of **added** domains. Every domain has its own sign-in page, `auth.<domain>`, and its own member list. A person has one account — one password, one TOTP — and reaches a domain's protected hosts (`authenticated` and `restricted` tunnels, protected sites, plugin user and web surfaces, OIDC sign-ins of the domain's plugins) only as a member of it. Admin stays relay-wide: the admin certificate manages every domain. The panel (`panel.`) and the tunnel endpoint (`tunnel.`) stay on the primary.

While the relay has one domain, every user is its member and nothing looks different. See [DNS & Domains](../01-concepts/dns-and-domains.md#multiple-domains) and the guide [Adding a Second Domain](../02-guides/second-domain.md).

## Authentication

Every endpoint requires an admin certificate (mTLS) — agents never manage domains.

## Domain Object

| Field         | Type           | Description                                                                                               |
| ------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `name`        | string         | Lower case, two labels or more (`codelama.com.tr`)                                                        |
| `primary`     | boolean        | The panel's domain; exactly one; never removed                                                            |
| `status`      | string         | `pending` (added, sign-in not served) or `active` (`auth.<name>` issued, members admitted)                |
| `createdAt`   | string         | ISO 8601                                                                                                  |
| `activatedAt` | string \| null | ISO 8601, once active                                                                                     |
| `members`     | number         | Members, disabled users included (`GET /api/domains` only)                                                |
| `usedBy`      | object         | `{ tunnels, sites, plugins, registry }` — hostnames, plugin names, whether the registry trusts its issuer |

Domains never overlap: `a.samplepark.tr` cannot be added beside `samplepark.tr` (a browser sends a domain's cookies to every host under it).

## Endpoints

### `GET /api/domains`

Every domain, the primary first, with its member count and what uses it, and `newUsersNeedDomains` — whether users and invitations must name their domains (the relay has two or more; clients ask for domains only then).

```json
{
  "domains": [
    {
      "name": "samplepark.tr",
      "primary": true,
      "status": "active",
      "createdAt": "2026-10-25T10:00:00.000Z",
      "activatedAt": "2026-10-25T10:00:00.000Z",
      "members": 5,
      "usedBy": {
        "tunnels": ["gitlab.samplepark.tr"],
        "sites": [],
        "plugins": [],
        "registry": false
      }
    }
  ],
  "newUsersNeedDomains": false
}
```

### `POST /api/domains`

Add a domain, `pending`. Body `{ "name": "codelama.com.tr" }`. **201** `{ domain }`.

| Status | `code`                    | When                                                                                                                                   |
| ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_domain`          | Not a domain name                                                                                                                      |
| 400    | `public_suffix`           | A public suffix (`com.tr`, `github.io`), not a domain                                                                                  |
| 409    | `domain_overlap`          | The same as, or under or above, a domain                                                                                               |
| 409    | `same_registrable_domain` | Shares its registrable domain (eTLD+1, Public Suffix List) with a domain — an application on one could set cookies for the other       |
| 409    | `relay_host_taken`        | A tunnel, site or alias already holds one of its relay hostnames (`auth.`, `panel.`, `tunnel.`, `agent-*`); also refused at activation |

### `POST /api/domains/:name/verify-dns`

The DNS records the domain needs at its DNS host, each with what it resolves to now — `auth.<name>` (required) and the wildcard `*.<name>` (optional: one A record per hostname does as well; checked through a probe name). `ok` once every required record points at the relay. Clients show these records as they are; they derive none. Rate limited (30 a minute).

```json
{
  "ok": true,
  "expectedIp": "138.68.65.228",
  "records": [
    {
      "type": "A",
      "name": "auth.codelama.com.tr",
      "value": "138.68.65.228",
      "required": true,
      "purpose": "the domain’s sign-in page",
      "resolvedIps": ["138.68.65.228"],
      "ok": true
    },
    {
      "type": "A",
      "name": "*.codelama.com.tr",
      "value": "138.68.65.228",
      "required": false,
      "purpose": "every tunnel and site hostname — or one A record per hostname instead",
      "resolvedIps": [],
      "ok": false
    }
  ]
}
```

### `POST /api/domains/:name/activate`

Issue the certificate of `auth.<name>` (HTTP-01), write its vhost, add its Authelia session cookie, render its members into Authelia's `access_control` and OIDC authorization policies and into Gatekeeper's projection, restart Authelia — one operation, rolled back as a whole on failure. Rate limited (10 a minute). **200** `{ domain }`.

| Status | `code`                                           | When                                   |
| ------ | ------------------------------------------------ | -------------------------------------- |
| 404    | `domain_not_found`                               |                                        |
| 502    | `cert_failed`, `nginx_failed`, `authelia_failed` | The step named failed; nothing changed |

### `DELETE /api/domains/:name`

Remove a domain: its memberships end (audited, reason `domain-removed`), its sign-in and session cookie go. **200** `{ removed: true }`.

| Status | `code`           | When                                                                            |
| ------ | ---------------- | ------------------------------------------------------------------------------- |
| 400    | `primary_domain` | The primary is never removed                                                    |
| 409    | `domain_in_use`  | A tunnel, site, plugin or the registry credential uses it — `usedBy` lists them |

### `GET /api/domains/:name/members`

`{ members: [{ userId, username, status, addedAt, addedBy }] }` — `status` is the directory's (`active`, `disabled`, `removed`).

### `PUT /api/domains/:name/members/:user`

Make a user a member — `:user` is a directory `userId` or the username of a user the directory holds. **200** `{ added }` (`false` when already one), with `warnings` when Gatekeeper or the audiences could not be brought along. A pending domain takes members too: they are let in when it is activated.

| Status | `code`           | When                |
| ------ | ---------------- | ------------------- |
| 404    | `user_not_found` |                     |
| 409    | `user_removed`   | The user is deleted |

### `DELETE /api/domains/:name/members/:user`

End a membership. **200** `{ removed }`. When the domain is the registry credential's issuer domain, the user's registry tokens are revoked too.

### `PUT /api/plugins/:name/domain`

Move a plugin to another active domain: `{ "domain": "codelama.com.tr" }`. A plugin belongs to one domain — its OIDC clients' `{domain}` and sign-in policy, which tunnels may be bound as its user surface, its web surface, its audience (entitled users who are members). **200** `{ name, domain, changed }`. **409** `surface_bound` while a tunnel is bound as its user surface or it owns a web surface; **400** `unknown_domain` for a domain that is not active.

## Memberships

- **Explicit, by `userId`.** A re-created username is a new user with no membership.
- **New users.** While the relay has one domain, every new user — created, invited, adopted from `users.yml` — becomes its member. With two or more, `POST /api/users` and `POST /api/invitations` take `domains` (required, and not empty: 400 `domains_required` — a user who is a member of nothing reaches nothing); a user adopted from `users.yml` gets none until an admin adds one. `PUT /api/users/:username` with `domains` sets a user's memberships exactly: the difference applied in one change, each membership audited.
- **Disable** keeps memberships; a disabled user is let in nowhere, and enabling restores them. **Delete** ends them.
- **Audit:** `domain.added`, `domain.activated`, `domain.removed`, `directory.membership.added`, `directory.membership.removed` — by `userId` and domain name, never username.

## Where membership is enforced

1. **Authelia** (`/etc/authelia/configuration.yml`): one `session.cookies` entry per active domain; `access_control` per site (its users ∩ members), per domain (members, then deny), `default_policy: deny`; per-domain OIDC `authorization_policies` (`lamaste_<domain with . as _>_<factor>`).
2. **Gatekeeper** (`/etc/lamalibre/lamaste/domains.json`, 0600, written by the panel): checked again after Authelia on every tunnel, user-surface and shell request; a missing or unreadable projection refuses. A signed-in non-member gets a refusal page (JSON `{ "error": "not_a_member" }` on a user surface) — never the sign-in page again.

## CLI

```
lamaste-server domains list
lamaste-server domains add codelama.com.tr
lamaste-server domains verify-dns codelama.com.tr
lamaste-server domains activate codelama.com.tr
lamaste-server domains members codelama.com.tr add onur
lamaste-server domains members codelama.com.tr remove onur
lamaste-server domains remove codelama.com.tr
lamaste-server plugins domain feria codelama.com.tr
lamaste-server tunnels create --subdomain feria --port 20060 --agent feria --domain codelama.com.tr
```

## Related

- [Users API](users.md) — `domains` on users and invitations
- [Tunnels API](tunnels.md), [Sites API](sites.md) — `domain` on creation
- [Registry and OIDC](registry-and-oidc.md) — one issuer per domain, `issuerDomain`
- [Gatekeeper](gatekeeper.md) — the membership check and refusal page
- Design: `packages/core/docs/multi-domain-relay-design.md`
