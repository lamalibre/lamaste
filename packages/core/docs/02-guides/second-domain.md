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

## 6. Brand its sign-in

Until a brand is set, `auth.codelama.com.tr` is Authelia's stock page — Authelia's logo, "Login - Authelia", "Powered by Authelia" — and the invitation and refusal pages say Lamaste. On the domain's card, **Branding** opens a form: the brand's name (required, up to 64 characters), a tagline (up to 160), Authelia's theme (`light`, `dark`, `grey`, `oled` or `auto`), an accent colour (`#rrggbb`), a support e-mail and an `https://` support URL; **Create brand** saves it. Then choose a **logo** (a PNG of at most 512 KiB and 1024 pixels a side — never SVG) and a **favicon** (an ICO, or a PNG of at most 256 pixels a side; at most 64 KiB). The preview beside the form shows the sign-in card as a visitor will see it. Or with the CLI:

```bash
sudo lamaste-server domains branding codelama.com.tr set --name "Code Lama" --theme dark --accent "#1f6feb" --support-email help@codelama.com.tr
sudo lamaste-server domains branding codelama.com.tr logo ./logo.png
sudo lamaste-server domains branding codelama.com.tr favicon ./favicon.ico
sudo lamaste-server domains branding codelama.com.tr preview
```

The brand reaches every page a visitor of the domain can meet: the sign-in (its title "Login - Code Lama" in every language Authelia has, the logo, the favicon, the theme, the accent on buttons and focus rings; the "Powered by" footer is hidden), the invitation page at `auth.codelama.com.tr/invite/<token>`, and the access-request and refusal pages on the domain's hosts, where the support e-mail is the contact. A brand may be set while the domain is still pending; it is served from the activation. Nothing an operator types reaches the sign-in as code: the name cannot carry `<`, `>`, `{` or `}`, the colour is a regex, the images are parsed — no CSS, HTML or SVG. **Remove brand** puts the stock pages back.

## What members see

- A member signs in at `auth.<domain>` once per domain (browsers never share cookies between domains), with the same password and TOTP.
- A signed-in non-member gets a "not a member of this domain" page with your contact and a sign-out link.
- `authenticated` means "any member of this domain"; `restricted` still needs a Gatekeeper grant.

## External members

A client's people can sign in on your domain without reaching all of it: make them **external** members. An external member reaches only what names them:

- a `restricted` tunnel, user surface or web surface — with a Gatekeeper grant (to them, or a Lamaste group they are in);
- a protected static site that lists them in its allowed users;
- an OIDC client of a plugin on the domain that is granted to them (the plugin card's **OIDC sign-in**, or `lamaste-server plugins oidc-clients <plugin> grant <client> --user <name>`).

Every `authenticated` host stays closed to them — they get the access-request page. They hold no Authelia groups (`admins`, `feria-*`): remove a user's groups before making them external. A plugin's audience counts them when they are entitled to it, so the plugin sees them with their roles.

Make someone external when you create or invite them (the membership's kind, or **External member** on a one-domain relay), on the domain's **Members** list (**Make external**), or with the CLI:

```
lamaste-server domains members codelama.com.tr add client-ali --external
lamaste-server domains members codelama.com.tr kind onur external
```

None of this restarts Authelia or signs anyone out: a change applies at the person's next request.

## Removing a domain

Delete or move what uses it first (the card lists it), then **Remove**. Its memberships end; the primary can never be removed.

## Related

- [Domains API](../04-api-reference/domains.md) — [Branding](../04-api-reference/domains.md#branding)
- [DNS & Domains](../01-concepts/dns-and-domains.md#multiple-domains)
- [Authorization](../01-concepts/authorization.md)
