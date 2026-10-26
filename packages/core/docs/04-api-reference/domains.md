# Domains API

> The relay's base domains and who is a member of each — one relay, one user directory, a sign-in and a member list per domain.

## In Plain English

A relay serves one **primary** domain (the panel's, set at onboarding) and any number of **added** domains. Every domain has its own sign-in page, `auth.<domain>`, and its own member list. A person has one account — one password, one TOTP — and reaches a domain's protected hosts (`authenticated` and `restricted` tunnels, protected sites, plugin user and web surfaces, OIDC sign-ins of the domain's plugins) only as a member of it. Admin stays relay-wide: the admin certificate manages every domain. The panel (`panel.`) and the tunnel endpoint (`tunnel.`) stay on the primary.

A membership has a **kind**. A `member` reaches what the domain's members reach. An `external` member — a client's people, say — reaches only what names them: `restricted` tunnels, user surfaces and web surfaces that grant them (Gatekeeper grants, to them or a Lamaste group they belong to), static sites whose `allowedUsers` lists them, and OIDC clients granted to them. An external member holds no Authelia groups (`admins`, `feria-*`).

While the relay has one domain, every user is its member and nothing looks different — unless a user is made external. See [DNS & Domains](../01-concepts/dns-and-domains.md#multiple-domains) and the guide [Adding a Second Domain](../02-guides/second-domain.md).

## Authentication

Every endpoint requires an admin certificate (mTLS) — agents never manage domains.

## Domain Object

| Field             | Type           | Description                                                                                               |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------------------- |
| `name`            | string         | Lower case, two labels or more (`codelama.com.tr`)                                                        |
| `primary`         | boolean        | The panel's domain; exactly one; never removed                                                            |
| `status`          | string         | `pending` (added, sign-in not served) or `active` (`auth.<name>` issued, members admitted)                |
| `createdAt`       | string         | ISO 8601                                                                                                  |
| `activatedAt`     | string \| null | ISO 8601, once active                                                                                     |
| `members`         | number         | Members of kind `member`, disabled users included (`GET /api/domains` only)                               |
| `externalMembers` | number         | External members, disabled users included (`GET /api/domains` only)                                       |
| `usedBy`          | object         | `{ tunnels, sites, plugins, registry }` — hostnames, plugin names, whether the registry trusts its issuer |

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
      "externalMembers": 2,
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

Issue the certificate of `auth.<name>` (HTTP-01), write its vhost, add its Authelia session cookie and its rules to `access_control`, give its members and external members their groups in `users.yml` and write Gatekeeper's projection, restart Authelia — one operation, rolled back as a whole on failure. Rate limited (10 a minute). **200** `{ domain }`.

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

`{ members: [{ userId, username, status, kind, addedAt, addedBy }] }` — `status` is the directory's (`active`, `disabled`, `removed`); `kind` is `member` or `external`.

### `PUT /api/domains/:name/members/:user`

Make a user a member — `:user` is a directory `userId` or the username of a user the directory holds. Body `{ "kind": "member" | "external" }` (optional, `member`): a user who is a member already gets the kind named (audited `directory.membership.changed`). **200** `{ added, changed }` (both `false` when nothing changed), with `warnings` when Gatekeeper or the audiences could not be brought along. A pending domain takes members too: they are let in when it is activated.

A change applies at the user's next request — Authelia is not restarted (see [Where membership is enforced](#where-membership-is-enforced)).

| Status | `code`                   | When                                                                       |
| ------ | ------------------------ | -------------------------------------------------------------------------- |
| 404    | `user_not_found`         |                                                                            |
| 409    | `user_removed`           | The user is deleted                                                        |
| 409    | `external_member_groups` | Making a user external who holds Authelia groups — remove the groups first |

### `DELETE /api/domains/:name/members/:user`

End a membership. **200** `{ removed }`. When the user no longer reaches the registry's sign-in (a member of none of the registry's domains, nor an external member of one granted its client), their registry tokens are revoked too.

### `PUT /api/plugins/:name/domain`

Move a plugin to another active domain: `{ "domain": "codelama.com.tr" }`. A plugin belongs to one domain — its OIDC clients' `{domain}` and sign-in policy, which tunnels may be bound as its user surface, its web surface, its audience (entitled users who are members). **200** `{ name, domain, changed }`. **409** `surface_bound` while a tunnel is bound as its user surface or it owns a web surface; **400** `unknown_domain` for a domain that is not active.

## Memberships

- **Explicit, by `userId`.** A re-created username is a new user with no membership.
- **Kinds.** `member` or `external`, per membership: a user may be a member of one domain and an external member of another. Where a request names memberships (`domains` on users and invitations) each is a domain name — a `member` — or `{ "name": "codelama.com.tr", "kind": "external" }`; one domain named with two kinds is refused (400 `conflicting_membership`). Answers always carry `{ name, kind }`.
- **New users.** While the relay has one domain, every new user — created, invited, adopted from `users.yml` — becomes its member unless the request names it as `external`. With two or more, `POST /api/users` and `POST /api/invitations` take `domains` (required, and not empty: 400 `domains_required` — a user who is a member of nothing reaches nothing); a user adopted from `users.yml` gets none until an admin adds one. `PUT /api/users/:username` with `domains` sets a user's memberships exactly: the difference applied in one change, each membership audited.
- **External members hold no Authelia groups.** Giving one a group, making a user with groups external, or inviting with both is refused (`external_member_groups`). Lamaste groups (Gatekeeper's) are not Authelia groups: grants to them reach external members too.
- **Disable** keeps memberships; a disabled user is let in nowhere, and enabling restores them. **Delete** ends them.
- **Audit:** `domain.added`, `domain.activated`, `domain.removed`, `directory.membership.added` (with `kind`), `directory.membership.changed` (`from`, `to`), `directory.membership.removed` — by `userId` and domain name, never username.

## Where membership is enforced

1. **Authelia.** Who is let in lives in `users.yml` as groups Lamaste owns, which Authelia watches (`authentication_backend.file.watch: true`, `refresh_interval: always`, its own password change and reset disabled) and re-reads at every request — so a membership, a kind, a grant or a site's `allowedUsers` changes without restarting Authelia or ending anyone's session:
   - `lamaste:m:<key>`, `lamaste:x:<key>` — the domain's members and external members, `<key>` a random key of the domain record (a group names no domain);
   - `lamaste:s:<site id>` — a protected static site's listed users;
   - `<hostname>` — the external members granted a `restricted` tunnel, user surface or web surface (enabled; a tunnel without an access mode is restricted);
   - `lamaste:oidc@<client id>` — the external members granted a user-facing OIDC client.

   `configuration.yml` names only those groups and changes only with the domains and protected sites (Authelia restarts then): one `session.cookies` entry per active domain; `access_control` per protected site (its site group; admins who are members), then per domain — its sign-in portal `auth.<domain>` for members and external members, members on every host, external members only on a host whose name is one of their groups (`domain_regex` with a `(?P<Group>…)` capture), deny — and `default_policy: deny`; one OIDC authorization policy per user-facing client (`lamaste_client_<id>`: members of its domain, external members with its group). The panel never shows these groups as groups, refuses assigning a name with `.`, `:` or `@` (400 `reserved_group`), and Gatekeeper strips them from `Remote-Groups`. Authelia's device-code flow checks a client's policy against the groups a session last refreshed, so a change that takes a device-code client away from someone restarts Authelia (every session ends) — the one change to a person that does.

2. **Gatekeeper** (`/etc/lamalibre/lamaste/domains.json`, version 2, 0600, written by the panel): checked again after Authelia on every tunnel, user-surface and shell request; a missing, unreadable or older projection refuses. A signed-in non-member gets a refusal page (JSON `{ "error": "not_a_member" }` on a user surface) — never the sign-in page again. An external member on an `authenticated` tunnel or web-surface shell gets the access-request page; on an `authenticated` user surface a 403 (`forbidden`); on a `restricted` host their grant decides, as for members. When Authelia itself refused an external member (no group names the host), Gatekeeper asks Authelia about the same session for `https://auth.<domain>/` to learn who it was, and answers them the same way; the request stays refused.

3. **Desktop user access** (the primary domain's): `authorize`, `exchange` and every session request require a `member` — an external member gets no desktop session.

## CLI

```
lamaste-server domains list
lamaste-server domains add codelama.com.tr
lamaste-server domains verify-dns codelama.com.tr
lamaste-server domains activate codelama.com.tr
lamaste-server domains members codelama.com.tr add onur
lamaste-server domains members codelama.com.tr add client-ali --external
lamaste-server domains members codelama.com.tr kind client-ali member
lamaste-server domains members codelama.com.tr remove onur
lamaste-server plugins oidc-clients corral grant corral-web --user client-ali
lamaste-server domains remove codelama.com.tr
lamaste-server plugins domain feria codelama.com.tr
lamaste-server tunnels create --subdomain feria --port 20060 --agent feria --domain codelama.com.tr
```

## Related

- [Users API](users.md) — `domains` on users and invitations
- [Tunnels API](tunnels.md), [Sites API](sites.md) — `domain` on creation
- [Registry and OIDC](registry-and-oidc.md) — one issuer per domain, `issuerDomain`
- [Gatekeeper](gatekeeper.md) — the membership check and refusal page
- Design: `packages/core/docs/multi-domain-relay-design.md`, `packages/core/docs/external-members-design.md`
