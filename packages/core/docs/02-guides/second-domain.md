# Adding a Second Domain

> Serve another base domain from the same relay, with its own sign-in and its own members — `codelama.com.tr` beside `samplepark.tr`, or a customer's domain.

## In Plain English

One relay can serve several domains. Each gets a sign-in page at `auth.<domain>` and a member list; a person signs in to each domain once with the same account and reaches only the domains they are a member of. The panel and the tunnel endpoint stay on the primary domain, so agents change nothing.

## 1. Add the domain

Panel → **Domains** → enter the name → **Add domain**, or:

```bash
sudo lamaste-server domains add codelama.com.tr
```

It is `pending`: nothing is served on it yet.

## 2. Create the DNS records

At the domain's DNS host, point the sign-in at the relay:

| Type | Name                   | Value            |
| ---- | ---------------------- | ---------------- |
| A    | `auth.codelama.com.tr` | the relay's IPv4 |

Then either one wildcard for every later hostname, or one record per hostname:

| Type | Name                | Value            |
| ---- | ------------------- | ---------------- |
| A    | `*.codelama.com.tr` | the relay's IPv4 |

Explicit records keep precedence over a wildcard, so an apex, `www` or mail (MX, SPF, DKIM) record elsewhere stays as it is. Some DNS hosts (Turhost among them) take a wildcard as a plain record named `*`; if yours refuses one, create an A record per hostname as you add tunnels and sites. Certificates are Let's Encrypt HTTP-01 per hostname, issued by the relay — the DNS host does not matter.

**Check DNS** on the domain's card (or `lamaste-server domains verify-dns codelama.com.tr`) lists the records the panel expects and whether each resolves here.

## 3. Choose the members

Add members on the domain's card (**Members**), or `lamaste-server domains members codelama.com.tr add <username>`. Members of a pending domain are let in the moment it goes live. From now on new users and invitations name their domains.

## 4. Activate

**Activate** (or `lamaste-server domains activate codelama.com.tr`) issues `auth.codelama.com.tr`, serves its sign-in and admits its members. It is one operation: if the certificate, nginx or Authelia step fails, nothing changes.

## 5. Put hostnames on it

Tunnel and managed-site forms gain a **Domain** picker; the CLI takes `--domain`. A plugin belongs to one domain: move it on its card (or `lamaste-server plugins domain <name> <domain>`) before giving it a user or web surface there.

## What members see

- A member signs in at `auth.<domain>` once per domain (browsers never share cookies between domains), with the same password and TOTP.
- A signed-in non-member gets a "not a member of this domain" page with your contact and a sign-out link.
- `authenticated` means "any member of this domain"; `restricted` still needs a Gatekeeper grant.

## Removing a domain

Delete or move what uses it first (the card lists it), then **Remove**. Its memberships end; the primary can never be removed.

## Related

- [Domains API](../04-api-reference/domains.md)
- [DNS & Domains](../01-concepts/dns-and-domains.md#multiple-domains)
- [Authorization](../01-concepts/authorization.md)
