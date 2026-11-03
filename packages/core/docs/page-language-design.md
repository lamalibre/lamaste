# Page Language — Design Document

> **Status:** draft 2026-11-03, for review. Wave 0 (inventory and design) only; nothing built. Decisions D1–D13 below await the founders; an independent review of this document and an independent reading of the Turkish (§8) come before wave 1.
> **Target:** Lamaste 4.10.0, on top of 4.9.0 (`develop` at `d5bc67f`). The tag `v4.9.0` is not touched. Tagging, publishing and the live relay are the founders'.
> **Pilot:** a plugin with a Turkish UI whose coordinator invites colleagues (delegated invitations, 4.9.0) on a domain whose people read Turkish. Lamaste holds no client content: every example here and in the tests uses invented domains (`alpha.test`-style names, as the existing specs do).
> **Companions:** `auth-branding-design.md` (the per-domain rendering this builds on), `delegated-invitations-design.md` (the inviter's and invitee's pages), `multi-domain-relay-design.md` (Gatekeeper's projection), `external-members-design.md`.

## Goal

Every page a person meets on these three paths speaks the language of the
domain they are on:

1. **Inviting.** A coordinator opens `https://auth.<domain>/invitations/<route>`,
   signs in if needed, invites a colleague and copies the link.
2. **Accepting.** The colleague opens `https://auth.<domain>/invite#<token>`,
   creates the account and two-factor setup, signs in, and reaches the
   plugin's site.
3. **Being turned away.** Someone refused, revoked or never admitted meets a
   refusal or access-request page, or a sign-in that no longer works.

In 4.9.0 every one of these pages is English (`lang="en"` in
`server/auth-pages.ts` and Gatekeeper's `templates.ts`), and nothing chooses a
language. Authelia's portal is the one exception: it follows the visitor's
browser, and its Turkish is incomplete.

Out of scope: the admin panel, the desktop app, the CLI and the agent panels
(operator surfaces, English); the plugin's own UI (the plugin's to translate);
other languages than English and Turkish (the mechanism takes more; the
catalogue grows by review, one language at a time).

## Inventory

### Pages on the three paths

| #   | Page                                                                                                                                                                      | Served by                                                                                                                                              | Text sources today                                                                                                                                                                                                                                                                                                                                                                                                                              | In scope                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P1  | Inviter's page `auth.<d>/invitations/<route>`                                                                                                                             | static file: core `server/invitations-page.ts` (`renderInvitationsPage`), the domain's rendering or the stock copy (`/var/www/lamaste/invitations`)    | shell (`<title>`, loading text, `lang="en"` in `auth-pages.ts`); ~40 strings in the inline script (headings, labels, hints, the bounds sentence with a plural, the link notice, Copy/Copied/Selected, the status words, Revoke/Really revoke?); the API's `error` texts shown verbatim (`errorOf`); dates by `toLocaleString(undefined, …)` (the browser's locale, not the page's); the browser's own `required`/`type=email` validation bubble | yes                                                                         |
| P2  | Invitation page `auth.<d>/invite#<token>` (both kinds)                                                                                                                    | static file: core `server/invite-page.ts` (`renderInvitePage`), rendering or stock (`/var/www/lamaste/invite`)                                         | shell; ~35 strings in the inline script (incl. the username rule with its bounds, password rules, the two-factor notice, the QR `alt`); the API's `error` texts shown verbatim (`lookup`/`accept`); dates as P1                                                                                                                                                                                                                                 | yes                                                                         |
| P3  | Authelia sign-in, second factor (one-time password), "authenticated", sign-out                                                                                            | Authelia 4.39.28 at `auth.<d>/`, index HTML rewritten by the auth vhost (`autheliaIndexRewrite`)                                                       | `/locales/<lang>/{portal,settings,consent}.json` (i18next); the index HTML's `<html lang="…">` and `<noscript>` text (Go template, `web/index.html`)                                                                                                                                                                                                                                                                                            | yes, by configuration (§3)                                                  |
| P4  | Authelia account settings (reached from the sign-in app bar once signed in)                                                                                               | Authelia                                                                                                                                               | `settings` namespace                                                                                                                                                                                                                                                                                                                                                                                                                            | yes, same mechanism                                                         |
| P5  | Authelia OIDC consent                                                                                                                                                     | Authelia                                                                                                                                               | `consent` namespace                                                                                                                                                                                                                                                                                                                                                                                                                             | not on these paths; covered by the same files                               |
| P6  | Access-request page (restricted tunnel/site, not in the plugin's audience, external member not granted)                                                                   | Gatekeeper, inline (`buildAccessRequestPage`) — on tunnel hosts (`/internal/lamaste/authz`) and on the plugin's site (`/internal/lamaste/shell-authz`) | ~15 strings, the message templates (e-mail subject/body, Slack/Teams, WhatsApp, generic), "Admin:"/"Help:", the default `adminName` ("Administrator", "your administrator"), the copy script's Copy/Copied — whose `textContent.replace(/Copy$/, '')` assumes the English label                                                                                                                                                                 | yes                                                                         |
| P7  | Domain refusal page (signed in, not a member; a static site that refused)                                                                                                 | Gatekeeper, inline (`buildDomainRefusalPage`, three variants)                                                                                          | ~10 strings, the sign-out sentence                                                                                                                                                                                                                                                                                                                                                                                                              | yes                                                                         |
| P8  | The plugin's site when its web surface is not served                                                                                                                      | the web-surface vhost (`renderWebSurfaceVhost`, `return 503`) — **nginx's stock error page**                                                           | "503 Service Temporarily Unavailable … nginx", English, unbranded                                                                                                                                                                                                                                                                                                                                                                               | yes — replaced by a Lamaste page (D10)                                      |
| P9  | The plugin's site when Gatekeeper refuses with an empty 403 (`not_served`, a malformed request)                                                                           | `error_page 403 = /internal/lamaste/shell-authz` answers with no body → **nginx's stock 403**                                                          | "403 Forbidden … nginx"                                                                                                                                                                                                                                                                                                                                                                                                                         | yes — the same Lamaste page, its "not allowed" variant (D10)                |
| P10 | The plugin's own shell and API answers                                                                                                                                    | the plugin                                                                                                                                             | the plugin's                                                                                                                                                                                                                                                                                                                                                                                                                                    | **no** — the plugin translates its UI; Lamaste's JSON stays a contract (D7) |
| P11 | JSON bodies nginx, Gatekeeper and the panel write for scripts: `{"error":"unauthenticated"}`, `{"error":"forbidden"}`, `{"error":"not_a_member"}`, `userSurfaceErrorText` | nginx `return …`, Gatekeeper, core `agent-forwarder.ts`                                                                                                | API contract                                                                                                                                                                                                                                                                                                                                                                                                                                    | **no** — codes, not prose; the pages and plugins map them (D7)              |

Not text Lamaste can translate, and why:

- **Names that come from elsewhere**: the plugin's display name and role
  labels (its manifest — a Turkish plugin labels its roles in Turkish), the
  inviter's display name, usernames, host names, the brand's name and tagline
  (the operator's).
- **The browser's own UI**: a native form-validation bubble (`required`,
  `type="email"`) speaks the browser's language. The pages switch it off
  (`novalidate`) and validate in their own words (D12).
- **Authelia texts outside its locale files**: none found on these paths
  besides `<noscript>` and `lang`, which the vhost rewrites (§3).

### E-mails

None on these paths. Lamaste sends no mail: the inviter sends the link
themselves (delegated-invitations D-decisions), and the access-request page
only pre-fills a `mailto:` the person's own mail client sends. Authelia's
notifier is `filesystem` (`core/lib/src/server/authelia.ts`, `notifier.filesystem`),
so its one-time codes (identity verification for registering a security key
in the settings) go to a file on the relay, never to a person; password
reset and change are disabled (`password_reset`/`password_change`
`disable: true`). The pre-filled `mailto:` texts are P6's message templates
and are translated with it (D11).

### Count

Five page renderers Lamaste owns are translated (P1, P2, P6, P7 and the new
P8/P9 page); Authelia's portal (P3–P5) is put in the domain's language by
configuration and a Lamaste supplement of its missing Turkish keys. Two kinds
of text stay untranslated by design: the plugin's own (P10) and JSON API
bodies (P11).

## What Authelia 4.39.28 can and cannot do (verified)

Read at the pinned tag (`https://github.com/authelia/authelia/tree/v4.39.28`):

- **Language detection is the browser's.** `web/src/i18n/index.ts` (generated)
  configures i18next with `detection.order: ["localStorageCustom", "navigator"]`:
  first the visitor's own choice from the language menu (localStorage
  `lang.preference`, `web/src/i18n/detectors/localStorageCustom.ts`,
  `web/src/constants/LocalStorage.ts`), then `navigator.languages`. No query
  parameter, no cookie lookup. The detected language is _cached_ in a cookie
  `language` (`caches: ["cookie"]`), read only by the server (below).
- **No server setting chooses a language.** `internal/configuration/schema/keys.go`
  has no language or locale key (the only hit is LDAP's `attributes.locale`).
- **`<html lang>` is the cookie's.** `internal/server/template.go`
  `ServeTemplatedFile`: `lang := "en"`, replaced by the `language` cookie when
  it matches `^[a-zA-Z0-9-]{1,15}$`; `web/index.html` renders
  `<html lang="{{ .Language }}">`. The React app never updates it.
- **Turkish ships, incomplete.** `internal/server/locales/tr-TR/` has
  `portal.json`, `settings.json`, `consent.json`; `/locales/tr/…` resolves to
  `tr-TR` (`internal/server/asset.go` `newLocalesPathResolver`: a parent
  language is aliased to its first locale). Against `en` (keys are the English
  source strings): **portal 98 of 114** keys translated (16 missing: "Loading",
  "Settings", "Language", "Warning", "Switch User", "Sign in with a passkey",
  "Toggle password visibility", "You have made too many requests", …),
  **settings 130 of 167** (37 missing), **consent 35 of 66** (31 missing); one
  stale key in portal and one in consent. A missing key falls back to English
  (`fallbackLng: { "tr-TR": ["tr", "en"], tr: ["en"] }`), so a Turkish visitor
  today reads a mix. Some present values are poor ("Tarafından
  desteklenmektedir {{authelia}}" for "Powered by {{authelia}}"; "{{len}}
  karakter uzunluğunda olmalıdır" for "Must be at least {{len}} characters in
  length"; a first-person "iptal edemedim").
- **What a file can override, per host, without forking** — the mechanism
  4.8.0 already uses: `/locales/<lang>[-<variant>]/<ns>.json` is answered by the
  auth vhost from the domain's rendering before Authelia (`authBrandLocations`).
  Every path the portal can request is `/locales/<detected or chosen>/<ns>.json`
  plus its parent and `en` (`load: "all"`, `fallbackLng`), for the namespaces
  `consent`, `portal`, `settings` (`ns`). Authelia itself answers a variant it
  does not embed with its sibling (`de-AT` → `de-DE`) or with `{}` (`en-US`), so
  rendering one file per listed locale — what 4.8 does for brands — cannot
  force a language: a `de-AT` browser would still get German from Authelia. A
  **regex location** in the auth vhost that answers _every_ locale path of a
  namespace with one rendered file can.
- **The language menu** (`web/src/components/AppBarItemLanguage.tsx`, rendered
  by `LoginLayout` through `AppBarLoginPortal` on every portal view) is a
  `button#language-button`. If every locale path yields the domain's language,
  the menu would offer choices that change nothing; a stylesheet rule hides it.
- **The index HTML** can be rewritten by `sub_filter` (literal strings, as for
  the theme): `<html lang="` is always present literally, so
  `sub_filter '<html lang="' '<html lang="tr" data-authelia-lang="'` sets the
  page's language whatever the cookie holds (the cookie's value moves into a
  harmless data attribute); the `<noscript>` sentence is a literal too.

So: Authelia **can** be put in a domain's language entirely from nginx and
the rendering Lamaste already writes; it **cannot** be told a default, and
its Turkish needs a supplement. Every contract this relies on (the detection
order, the namespaces, the menu's id, the `lang` literal, the `noscript`
text) is pinned by a unit test against fixtures of 4.39.28's files, as the
theme contract is (`test/fixtures/authelia-4.39.28-*`), so a pin bump that
moves one fails the build, not the visitor. (The existing locale fixtures are
excerpts; wave 1 adds full verbatim copies of `en` and `tr-TR` for the three
namespaces, Apache-2.0, with their source URLs.)

## Design

### 1. The language is the domain's (D1, D2, D3)

`state.db` migration `0021_domain_language.sql`:

```sql
-- The language every page on the domain speaks (page-language-design.md):
-- NULL = not set — Lamaste's pages English, Authelia's portal following the
-- visitor's browser, exactly as before 4.10. Values are validated in code
-- (core PAGE_LANGUAGES), so a new language needs no migration.
ALTER TABLE domains ADD COLUMN language TEXT;
```

- A domain property, beside its sign-in host and its members — not part of
  the brand. An unbranded domain can be Turkish; a branded one can be left
  unset. (The brand record has its own revision and `ifRevision`; the language
  is one value, set or cleared, and audited `domain.language.updated` with the
  old and new value.)
- Values: `en`, `tr` (core `PAGE_LANGUAGES`), or unset. Unset changes nothing
  on upgrade. **Set means every page on the domain speaks that language**,
  Authelia included — `en` forces English too.
- **`Accept-Language` plays no part** (D3). Reasons: every page on the domain
  agrees (Lamaste's pages, Authelia, Gatekeeper's); the operator who knows the
  domain's people decides, once; Lamaste's static pages stay one file per
  domain with one CSP hash pair per release (§4), no `Vary`, nothing for a
  cache or a proxy to mix up; Gatekeeper's refusal pages need no per-request
  negotiation; the curl-driven rodeo specs can assert every page. Lamaste's
  catalogue has two languages: negotiating among them buys little and would
  split one domain's pages between Authelia's 70 languages and Lamaste's two.
  The model keeps the door open (a later "domain default + negotiation" is
  additive).

### 2. Where each page gets its language

| Page   | How                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1, P2 | rendered into the domain's rendering (§5) with `lang`, `<title>`, loading text and a JSON data block of messages (§4); the stock copies (unset domains) are English                   |
| P3–P5  | the auth vhost serves the rendering's forced locale files and rewrites `lang` and `<noscript>` (§3)                                                                                   |
| P6, P7 | Gatekeeper renders them server-side in the language of the host's domain, read from the projection `domains.json` (D8)                                                                |
| P8, P9 | a static page in the domain's rendering (`unavailable/index.html`, two variants by a fragment-free path), English stock copy for unset domains; served by the web-surface vhost (D10) |

### 3. Authelia on a domain with a language (D4, D5)

The rendering holds, per namespace, **one** file in the domain's language —
`locales/forced/<ns>.json` — built from:

1. Authelia's embedded file for the language (`tr-TR`, fetched from the
   running Authelia as 4.8 fetches every locale: `fetchAutheliaLocales`);
2. Lamaste's **supplement** for the keys Authelia lacks in that language
   (core catalogue, reviewed Turkish, §8.3) and a short list of
   **corrections** (§8.4);
3. Authelia's `en` value for any key still missing — a unit test makes that
   set empty for the pinned release, so it only ever happens after a pin bump
   that added keys, and the bump's tests list them;
4. the brand name spliced into `{{authelia}}` when the domain has a brand
   (`renderBrandLocale`, unchanged).

For `en` the file is Authelia's `en` (brand-spliced). The auth vhost of a
domain with a language then carries:

```nginx
    # Every locale the portal can ask for: the domain's language
    location ~ "^/locales/[a-z]{1,3}(-[A-Za-z0-9-]{1,24})?/(consent|portal|settings)\.json$" {
        root /var/www/lamaste/auth/<domain>;
        try_files /locales/forced/$2.json @authelia;
        add_header X-Content-Type-Options nosniff;
        add_header Cache-Control "public, max-age=0, must-revalidate";
    }
```

and, in the `/` location's index rewrite (beside the theme and logo
filters):

```nginx
        sub_filter '<html lang="' '<html lang="tr" data-authelia-lang="';
        sub_filter 'You need to enable JavaScript to run this app.' 'Bu uygulama için tarayıcınızda JavaScript etkin olmalıdır.';
        sub_filter '</head>' '<link rel="stylesheet" href="/brand.css"></head>';
```

`brand.css` is rendered for every domain with a rendering; on a domain with a
language it holds `#language-button { display: none !important; }` (and the
brand's colours and footer rule when branded). The regex location wins over
the `/locales/` prefix location (nginx checks regexes after prefixes not
marked `^~`). `lamaste-priv` already allows regex locations, `try_files`
arguments with `$`, and `sub_filter` literals without `$`; wave 2 confirms
the quoted regex and the `sub_filter` value with its tests
(`lamaste-priv.test.js`, `nginx-vhosts.test.js`). A domain without a language
keeps today's vhost exactly.

The `@authelia` fallback is reached only if the rendering lacks the file
(a rendering in progress cannot be seen: the link switches by rename).

### 4. Lamaste's static pages: one script, messages as data (D6)

The invitation and inviter pages' inline script and style must stay **one
text for every domain** — nginx sends their CSP hashes, one pair per release
(`INVITE_PAGE_HEADERS`, `INVITATIONS_PAGE_HEADERS`). So the words leave the
script:

```html
<html lang="tr">
  <head>
    <title>Example Brand — Daveti Kabul Et</title>
    …
  </head>
  <body>
    …
    <script type="application/json" id="lamaste-messages">
      {"lang":"tr","invite.invalidLink":"Bu davet bağlantısı geçerli değil.", …}
    </script>
    <script>
      /* the one script, hashed */
    </script>
  </body>
</html>
```

- A `type="application/json"` script element is a data block: the browser
  never executes it, so CSP's `script-src` does not apply (inferred from the
  HTML standard's "prepare the script element", which returns before any CSP
  check for a data block; **to verify in the wave-4 browser pass**). The JSON
  is serialised with `<`, `>`, `&`, U+2028 and U+2029 escaped as `\u…`, so no
  catalogue text can end the element.
- The script reads it once (`JSON.parse(…textContent)`), formats with
  `{name}` placeholders, picks plurals with `Intl.PluralRules(lang)`, and
  formats dates with `toLocaleString(lang, …)` — the page's language, not the
  browser's.
- `<title>`, the loading text and `lang` are rendered server-side from the
  same catalogue.
- `authPagesDigest()` (which decides whether a rendering is current) covers
  the pages of **every** language, so a catalogue change re-renders every
  domain once at the next start, as a page change does today.

### 5. The rendering, generalised (D9)

Today a domain has a rendering only when it has a brand. From 4.10 a domain
has one when it has a brand **or** a language; `renderAuthBranding` takes
`brand: BrandFields | null` and `language: PageLanguage | null`:

| File                                                           | Brand only       | Language only            | Both                  |
| -------------------------------------------------------------- | ---------------- | ------------------------ | --------------------- |
| `favicon.ico`, `static/media/logo.png`                         | when set         | —                        | when set              |
| `locales/<locale>/<ns>.json` (4.8)                             | yes              | —                        | —                     |
| `locales/forced/<ns>.json`                                     | —                | yes                      | yes                   |
| `brand.css`                                                    | yes              | yes (menu rule only)     | yes                   |
| `invite/index.html`, `invitations/index.html`, `unavailable/…` | branded, English | stock look, the language | branded, the language |
| `brand.json`                                                   | yes              | —                        | yes                   |
| `rendered.json`                                                | + `language`     | + `language`             | + `language`          |

`rendered.json` gains `language` (absent = null, as a 4.9 rendering reads);
the reconcile re-renders when the record's brand revision, the language, the
Authelia release or the pages' digest differ. A domain whose brand is removed
but whose language is set keeps a rendering (unbranded). The directory name
keeps `<domain>-<revision>-<hex>` with revision 0 for an unbranded rendering.
`brand.json` stays brand-only, so Gatekeeper's brand reader is unchanged.

### 6. The APIs' refusals carry codes; their texts stay English (D7)

The pages show the API's `error` text verbatim today. Instead, every refusal
the two public APIs can give gets a `code`, and the pages map codes to their
catalogue; the `error` text stays English (the panel, the CLI, logs and
scripts read it).

Codes to add (wave 2), beside those that exist (`invalid_request` with
`field`, `username_unavailable`, `invitation_accepting`,
`invitation_unavailable`, `invitation_revoked`, `gatekeeper_unavailable`,
`authelia_storage_unavailable`, `invitations_unavailable`,
`email_domain_not_allowed`, `role_not_grantable`, `invitation_rate`,
`invitation_cap` with `cap`, `grant_reserve`):

| Where                                                               | Today                                             | Code                                               |
| ------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------- |
| `invitation-acceptance.js` `openedInvitation` (404 ×2)              | "Invitation not found"                            | `invitation_not_found`                             |
| `assertOpen` 410 accepted                                           | "This invitation has already been used"           | `invitation_used`                                  |
| `assertOpen` 410 expired                                            | "This invitation has expired"                     | `invitation_expired`                               |
| `assertOpen` 410 revoked; `invitations.js` 357, 385; acceptance 610 | "…no longer valid" / "…can no longer be accepted" | `invitation_closed`                                |
| acceptance 636 409                                                  | "This username already exists"                    | `username_unavailable` (one answer, as 4.9's rule) |
| acceptance 500s                                                     | "Failed to process password", …                   | none: 5xx → generic                                |
| `delegated-invitations.js` 704/709 404                              | "Invitation not found"                            | `invitation_not_found`                             |
| route `DELETE` bad id 404, `GET`/`POST` route checks                | "Not found"                                       | `not_found`                                        |
| `@fastify/rate-limit` 429                                           | its English message                               | by status: 429 → generic "too many requests"       |

A page shows the catalogue text for a known code, else a text chosen by
status (404, 409, 410, 429, 5xx, other), never the server's English. A unit
test lists every `httpError(` on these routes' paths and fails on one without
a code that a page cannot map.

### 7. Gatekeeper (D8, D11)

- The projection `domains.json` (v2) gains an optional `language` per domain.
  `parseDomainsProjection` reads it **leniently**: a missing or unknown value
  means "not set" and never invalidates the projection (membership stays
  fail-closed; presentation fails open). The version stays 2: a 4.9 Gatekeeper
  ignores the field, a 4.10 Gatekeeper reads a 4.9 file as all-unset. The panel
  writes the projection on every language change (it already does on every
  domain change, under `withDomainRendering`).
- `TemplateOptions` gains `language`; `pageOptions` sets it from the
  projection for the host's domain (`domainShownFor`), null for a host under
  no domain (English).
- P6's copy button keeps its label in a `data-` attribute and copies the
  template element's own text, not `textContent` minus a trailing "Copy".
- P6's and P7's `lang` follows the language; the dark look is unchanged.
- The default `adminName` becomes the catalogue's ("your administrator" →
  "yöneticiniz"); an operator-set name is shown as set.

### 8. Turkish copy

Principles for the reviewer:

- Formal throughout (**siz**): imperatives "girin", "seçin", "kopyalayın";
  questions "…mi?" addressed with siz.
- **Authelia's terms on the same screens win**, so the invitee meets one
  vocabulary: _şifre_ (not _parola_), _kullanıcı adı_, _giriş yap_, _oturumu
  kapat_, _Tek Seferlik Şifre_, _iki faktörlü kimlik doğrulama_.
- The plugin's vocabulary for people: _Davet_ (invitation), _Kişiler_
  (people), and role names as the plugin's manifest labels them (e.g.
  _Koordinatör_, _Üye_, _İzleyici_, _Kurucu_ in a Turkish plugin — Lamaste
  never writes a role name itself, it shows the label it is given).
- **Never put a suffix on an interpolated name**: vowel harmony depends on a
  word Lamaste does not know. A noun carries the suffix instead ("{plugin}
  uygulamasına", "{host} adresine", "{domain} alan adının"), or the name stands
  alone after a colon ("Hesabınız oluşturuldu: {username}").
- Usernames are ASCII (`a–z`, digits, `-`, `_`): the Turkish hint says so
  explicitly ("a–z arası küçük harfler"), since _ç, ğ, ı, ö, ş, ü_ are refused.
- Placeholders are `{name}` in Lamaste's catalogue and `{{name}}`, `<policy>`
  in Authelia's — kept verbatim.

#### 8.1 Lamaste's pages (P1, P2, P8/P9) — draft

| Key                                        | English                                                                                                              | Türkçe (draft)                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `invite.title`                             | Accept Invitation                                                                                                    | Daveti Kabul Et                                                                                                                                 |
| `invite.loading`                           | Loading invitation…                                                                                                  | Davet yükleniyor…                                                                                                                               |
| `invite.invalidLink`                       | This invitation link is not valid.                                                                                   | Bu davet bağlantısı geçerli değil.                                                                                                              |
| `invite.unavailableTitle`                  | Invitation Unavailable                                                                                               | Davet Kullanılamıyor                                                                                                                            |
| `invite.invitedTitle`                      | You’ve Been Invited                                                                                                  | Davet Edildiniz                                                                                                                                 |
| `invite.adminSubtitle`                     | Set your password to create your account.                                                                            | Hesabınızı oluşturmak için şifrenizi belirleyin.                                                                                                |
| `invite.delegatedBy`                       | {inviter} invited you to {plugin} as {role}.                                                                         | {inviter} sizi {plugin} uygulamasına {role} olarak davet etti.                                                                                  |
| `invite.delegated`                         | You are invited to {plugin} as {role}.                                                                               | {plugin} uygulamasına {role} olarak davet edildiniz.                                                                                            |
| `invite.username`                          | Username                                                                                                             | Kullanıcı adı                                                                                                                                   |
| `invite.usernameHint`                      | You sign in with it. Lower-case letters, digits, - and \_; it cannot be changed later.                               | Giriş yaparken bunu kullanırsınız. a–z arası küçük harfler, rakamlar, - ve \_ kullanılabilir; daha sonra değiştirilemez.                        |
| `invite.email`                             | Email                                                                                                                | E-posta                                                                                                                                         |
| `invite.expires`                           | Expires                                                                                                              | Son geçerlilik                                                                                                                                  |
| `invite.yourName`                          | Your name                                                                                                            | Adınız ve soyadınız                                                                                                                             |
| `invite.password`                          | Password                                                                                                             | Şifre                                                                                                                                           |
| `invite.passwordHint`                      | At least 8 characters                                                                                                | En az 8 karakter                                                                                                                                |
| `invite.confirmPassword`                   | Confirm password                                                                                                     | Şifre (tekrar)                                                                                                                                  |
| `invite.create`                            | Create Account                                                                                                       | Hesap Oluştur                                                                                                                                   |
| `invite.creating`                          | Creating account…                                                                                                    | Hesap oluşturuluyor…                                                                                                                            |
| `invite.usernameRule`                      | A username has {min} to {max} lower-case letters, digits, - and \_, and starts with a letter or digit.               | Kullanıcı adı {min}–{max} karakter olmalı, yalnızca a–z arası küçük harfler, rakamlar, - ve \_ içermeli ve bir harf ya da rakamla başlamalıdır. |
| `invite.nameRequired`                      | Enter your name.                                                                                                     | Adınızı girin.                                                                                                                                  |
| `invite.passwordShort`                     | A password has at least 8 characters.                                                                                | Şifre en az 8 karakter olmalıdır.                                                                                                               |
| `invite.passwordLong`                      | A password has at most 128 characters.                                                                               | Şifre en fazla 128 karakter olabilir.                                                                                                           |
| `invite.passwordMismatch`                  | The passwords do not match.                                                                                          | Şifreler eşleşmiyor.                                                                                                                            |
| `invite.createdTitle`                      | Account Created                                                                                                      | Hesabınız Oluşturuldu                                                                                                                           |
| `invite.created`                           | Your account {username} has been created.                                                                            | Hesabınız oluşturuldu: {username}                                                                                                               |
| `invite.scanQr`                            | Scan this QR code with your authenticator app to set up two-factor authentication.                                   | İki faktörlü kimlik doğrulamayı kurmak için bu QR kodunu kimlik doğrulama uygulamanızla tarayın.                                                |
| `invite.qrAlt`                             | Two-factor QR code                                                                                                   | İki faktörlü kimlik doğrulama QR kodu                                                                                                           |
| `invite.manualEntry`                       | Manual entry:                                                                                                        | Elle giriş:                                                                                                                                     |
| `invite.saveNow`                           | Save this before you leave the page — it is not shown again.                                                         | Sayfadan ayrılmadan önce bunu kaydedin; bir daha gösterilmeyecek.                                                                               |
| `invite.askAdminTotp`                      | Ask your administrator to set up two-factor authentication.                                                          | İki faktörlü kimlik doğrulamanın kurulması için yöneticinize başvurun.                                                                          |
| `invite.accessPending`                     | Your access is still being set up — if signing in shows nothing yet, try again in a minute.                          | Erişiminiz hâlâ hazırlanıyor. Giriş yaptığınızda henüz bir şey görmüyorsanız bir dakika sonra yeniden deneyin.                                  |
| `invite.goToSignIn`                        | Go to sign-in                                                                                                        | Giriş sayfasına gidin                                                                                                                           |
| `invitations.title`                        | Invite People                                                                                                        | Kişi Davet Et                                                                                                                                   |
| `invitations.loading`                      | Loading…                                                                                                             | Yükleniyor…                                                                                                                                     |
| `invitations.notFoundTitle`                | Not Found                                                                                                            | Bulunamadı                                                                                                                                      |
| `invitations.notFound`                     | There is no invitations page here.                                                                                   | Burada bir davet sayfası yok.                                                                                                                   |
| `invitations.signInTitle`                  | Sign In to Continue                                                                                                  | Devam Etmek İçin Giriş Yapın                                                                                                                    |
| `invitations.signInText`                   | Sign in to invite people.                                                                                            | Kişi davet etmek için giriş yapın.                                                                                                              |
| `invitations.signIn`                       | Sign in                                                                                                              | Giriş yap                                                                                                                                       |
| `invitations.signInLoop`                   | If signing in brings you back here again and again, clear this site’s cookies in your browser and sign in once more. | Giriş yaptıktan sonra tekrar tekrar bu sayfaya dönüyorsanız tarayıcınızda bu sitenin çerezlerini temizleyip yeniden giriş yapın.                |
| `invitations.unavailableTitle`             | Not Available                                                                                                        | Kullanılamıyor                                                                                                                                  |
| `invitations.unavailable`                  | You cannot invite people into this application, or invitations are turned off for it.                                | Bu uygulamaya kişi davet etme yetkiniz yok ya da uygulamada davetler kapalı.                                                                    |
| `invitations.errorTitle`                   | Something Went Wrong                                                                                                 | Bir Sorun Oluştu                                                                                                                                |
| `invitations.unreachable`                  | The relay could not be reached.                                                                                      | Sunucuya ulaşılamadı.                                                                                                                           |
| `invitations.to`                           | to {plugin}                                                                                                          | {plugin} uygulamasına                                                                                                                           |
| `invitations.noRole`                       | You may not invite anyone with your role.                                                                            | Rolünüzle kimseyi davet edemezsiniz.                                                                                                            |
| `invitations.email`                        | E-mail address                                                                                                       | E-posta adresi                                                                                                                                  |
| `invitations.emailDomains`                 | Under {domains}                                                                                                      | İzin verilen alan adları: {domains}                                                                                                             |
| `invitations.theirName`                    | Their name (optional)                                                                                                | Kişinin adı (isteğe bağlı)                                                                                                                      |
| `invitations.role`                         | Role                                                                                                                 | Rol                                                                                                                                             |
| `invitations.bounds_one` / `_other`        | A link works once and expires after {days} day / days. You have {open} of {max} open invitations.                    | Her bağlantı yalnızca bir kez kullanılabilir ve {days} gün sonra geçersiz olur. Açık davetleriniz: {open}/{max}. (one = other)                  |
| `invitations.create`                       | Create Invitation                                                                                                    | Davet Oluştur                                                                                                                                   |
| `invitations.ready`                        | The invitation is ready. Send this link yourself — it is shown only now, and whoever opens it first can accept it.   | Davet hazır. Bu bağlantıyı kişiye kendiniz gönderin: yalnızca şimdi gösteriliyor ve bağlantıyı ilk açan kişi daveti kabul edebilir.             |
| `invitations.copy` / `copied` / `selected` | Copy / Copied / Selected                                                                                             | Kopyala / Kopyalandı / Seçildi                                                                                                                  |
| `invitations.yours`                        | Your invitations                                                                                                     | Davetleriniz                                                                                                                                    |
| `invitations.none`                         | None yet.                                                                                                            | Henüz davet yok.                                                                                                                                |
| `invitations.back`                         | ← Back to {plugin}                                                                                                   | ← {plugin} uygulamasına dön                                                                                                                     |
| `invitations.revoke`                       | Revoke                                                                                                               | İptal et                                                                                                                                        |
| `invitations.reallyRevoke`                 | Really revoke?                                                                                                       | İptal edilsin mi?                                                                                                                               |
| `status.pending` … `revoked`               | Pending · Expired · Being accepted · Accepted · Revoked                                                              | Bekliyor · Süresi doldu · Kabul ediliyor · Kabul edildi · İptal edildi                                                                          |
| `unavailable.title`                        | Not Available Right Now                                                                                              | Şu Anda Kullanılamıyor                                                                                                                          |
| `unavailable.text`                         | This application is not available right now. Try again later.                                                        | Bu uygulama şu anda kullanılamıyor. Lütfen daha sonra yeniden deneyin.                                                                          |
| `forbidden.title`                          | Not Allowed                                                                                                          | İzin Verilmiyor                                                                                                                                 |
| `forbidden.text`                           | You cannot open this page.                                                                                           | Bu sayfayı açma izniniz yok.                                                                                                                    |

#### 8.2 Refusals the pages map (§6)

| Code (status)                                                                | English                                                                                      | Türkçe (draft)                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `invitation_not_found` (404)                                                 | This invitation link is not valid.                                                           | Bu davet bağlantısı geçerli değil.                                                                       |
| `invitation_used` (410)                                                      | This invitation has already been used.                                                       | Bu davet daha önce kullanılmış.                                                                          |
| `invitation_expired` (410)                                                   | This invitation has expired.                                                                 | Bu davetin süresi dolmuş.                                                                                |
| `invitation_closed` (410)                                                    | This invitation is no longer valid.                                                          | Bu davet artık geçerli değil.                                                                            |
| `invitation_revoked` (410)                                                   | This invitation was revoked while it was being accepted.                                     | Bu davet, kabul edilirken iptal edildi.                                                                  |
| `invitation_accepting` (409)                                                 | This invitation is being accepted right now.                                                 | Bu davet şu anda kabul ediliyor.                                                                         |
| `invitation_unavailable` (503)                                               | This invitation cannot be accepted right now — try again later.                              | Bu davet şu anda kabul edilemiyor. Lütfen daha sonra yeniden deneyin.                                    |
| `username_unavailable` (409)                                                 | This username is not available — choose another.                                             | Bu kullanıcı adı kullanılamıyor. Lütfen başka bir ad seçin.                                              |
| `invalid_request` + `field` username / password / displayName / email / role | Invalid username / password / name / e-mail address / role.                                  | Kullanıcı adı geçersiz. / Şifre geçersiz. / Ad geçersiz. / E-posta adresi geçersiz. / Rol geçersiz.      |
| `invalid_request` (no field)                                                 | Something you entered is not valid.                                                          | Girdiğiniz bilgilerden biri geçersiz.                                                                    |
| `invitations_unavailable` (403)                                              | Invitations are not available for this application.                                          | Bu uygulamada davetler şu anda kullanılamıyor.                                                           |
| `email_domain_not_allowed` (400)                                             | Invitations cannot go to this e-mail address’s domain.                                       | Bu e-posta adresinin alan adına davet gönderilemez.                                                      |
| `role_not_grantable` (403)                                                   | You may not invite people with this role.                                                    | Bu rolle kişi davet edemezsiniz.                                                                         |
| `invitation_rate` (429)                                                      | Too many invitations in the last hour — try again later.                                     | Son bir saatte çok fazla davet oluşturdunuz. Lütfen daha sonra yeniden deneyin.                          |
| `invitation_cap` `inviter` (409)                                             | You have reached your limit of open invitations — revoke one or wait for one to be accepted. | Açık davet sınırınıza ulaştınız. Bekleyen bir daveti iptal edin ya da birinin kabul edilmesini bekleyin. |
| `invitation_cap` `plugin` (409)                                              | This application takes no more people by invitation.                                         | Bu uygulamaya davetle daha fazla kişi eklenemiyor.                                                       |
| `grant_reserve` (503)                                                        | No more people can be added by invitation right now.                                         | Şu anda davetle yeni kişi eklenemiyor.                                                                   |
| `gatekeeper_unavailable`, `authelia_storage_unavailable` (503)               | The service is not answering — try again shortly.                                            | Hizmet şu anda yanıt vermiyor. Lütfen biraz sonra yeniden deneyin.                                       |
| `not_found` (404, the inviter's revoke)                                      | Invitation not found.                                                                        | Davet bulunamadı.                                                                                        |
| by status 429                                                                | Too many requests — wait a moment and try again.                                             | Çok fazla istek gönderildi. Lütfen biraz bekleyip yeniden deneyin.                                       |
| by status 5xx / other                                                        | Something went wrong — try again later.                                                      | Bir sorun oluştu. Lütfen daha sonra yeniden deneyin.                                                     |
| inviter's form, no address                                                   | Enter an e-mail address.                                                                     | Bir e-posta adresi girin.                                                                                |
| inviter's form, not an address                                               | Enter a valid e-mail address.                                                                | Geçerli bir e-posta adresi girin.                                                                        |

#### 8.3 Gatekeeper's pages (P6, P7)

| Key                               | English                                                                                                                   | Türkçe (draft)                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `access.title` / `access.heading` | Access Required                                                                                                           | Erişim Gerekli                                                                                                                                       |
| `access.noAccess`                 | You don't have access to {host}                                                                                           | {host} adresine erişiminiz yok                                                                                                                       |
| `access.signedInAs`               | Signed in as {username}                                                                                                   | Giriş yapılan hesap: {username}                                                                                                                      |
| `access.contact`                  | Contact {admin} to request access. Copy a message template below:                                                         | Erişim istemek için {admin} ile iletişime geçin. Aşağıdaki mesaj şablonlarından birini kopyalayabilirsiniz:                                          |
| `access.defaultAdmin`             | your administrator                                                                                                        | yöneticiniz                                                                                                                                          |
| `access.labelEmail`               | Email                                                                                                                     | E-posta                                                                                                                                              |
| `access.copy` / `copied`          | Copy / Copied                                                                                                             | Kopyala / Kopyalandı                                                                                                                                 |
| `contact.admin` / `contact.help`  | Admin: / Help:                                                                                                            | Yönetici: / Yardım:                                                                                                                                  |
| `template.subject`                | Access request for {resource}                                                                                             | {resource} için erişim talebi                                                                                                                        |
| `template.body`                   | Hi {admin},⏎⏎I'd like to request access to {resource}.⏎My username is: {username}⏎⏎Thank you.                             | Merhaba,⏎⏎{resource} adresine erişim talep ediyorum.⏎Kullanıcı adım: {username}⏎⏎Teşekkürler.                                                        |
| `template.chat`                   | Hi, could I get access to {resource}? My username is {username}.                                                          | Merhaba, {resource} adresine erişim alabilir miyim? Kullanıcı adım: {username}.                                                                      |
| `template.whatsapp`               | Hi, I need access to {resource} (username: {username}). Thanks!                                                           | Merhaba, {resource} adresine erişmem gerekiyor (kullanıcı adım: {username}). Teşekkürler!                                                            |
| `template.generic`                | Access request for {resource}⏎Username: {username}⏎Admin contact: {contact}                                               | {resource} için erişim talebi⏎Kullanıcı adı: {username}⏎Yönetici iletişim bilgisi: {contact}                                                         |
| `refusal.title`                   | Not allowed — {domain}                                                                                                    | İzin verilmiyor — {domain}                                                                                                                           |
| `refusal.notAllowedOn`            | Not allowed on {host}                                                                                                     | {host} adresine erişim izniniz yok                                                                                                                   |
| `refusal.notMember`               | Not a member of {domain}                                                                                                  | {domain} alan adının üyesi değilsiniz                                                                                                                |
| `refusal.noDomain`                | Your account is signed in, but this host is under none of this relay's domains, so nobody may open it.                    | Hesabınızla giriş yaptınız, ancak bu adres bu sunucunun alan adlarından hiçbirine bağlı olmadığı için kimse açamaz.                                  |
| `refusal.site`                    | Your account is signed in, but it may not open this site: it is not a member of {domain}, or not one of the site's users. | Hesabınızla giriş yaptınız, ancak bu siteyi açma izniniz yok: {domain} alan adının üyesi değilsiniz ya da sitenin kullanıcıları arasında değilsiniz. |
| `refusal.domain`                  | Your account is signed in, but it is not a member of this domain, so none of its applications are open to it.             | Hesabınızla giriş yaptınız, ancak bu alan adının üyesi olmadığınız için uygulamalarının hiçbirine erişemezsiniz.                                     |
| `refusal.ask`                     | Ask {admin} to add you if you should have access.                                                                         | Erişiminiz olması gerekiyorsa sizi eklemesi için {admin} ile iletişime geçin.                                                                        |
| `refusal.signOut`                 | [Sign out] to sign in with another account.                                                                               | Başka bir hesapla giriş yapmak için [oturumu kapatın].                                                                                               |

The e-mail body drops the salutation's name in Turkish ("Merhaba,"): a
default administrator name reads oddly after "Merhaba" and an operator-set
name is not always a person's.

#### 8.4 Authelia supplement and corrections (P3–P5)

Keys missing in Authelia 4.39.28's `tr-TR` (the values Lamaste supplies):

| Namespace | English (key)                                                                                                                                                                    | Türkçe (draft)                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| portal    | Enter your password to confirm your identity                                                                                                                                     | Kimliğinizi doğrulamak için şifrenizi girin                                                                                                             |
| portal    | Failed to confirm your identity                                                                                                                                                  | Kimliğiniz doğrulanamadı                                                                                                                                |
| portal    | Failed to redirect you                                                                                                                                                           | Yönlendirme yapılamadı                                                                                                                                  |
| portal    | Home                                                                                                                                                                             | Ana sayfa                                                                                                                                               |
| portal    | Language                                                                                                                                                                         | Dil                                                                                                                                                     |
| portal    | Loading                                                                                                                                                                          | Yükleniyor                                                                                                                                              |
| portal    | Logout and clear any current flow                                                                                                                                                | Oturumu kapat ve devam eden işlemi iptal et                                                                                                             |
| portal    | Logout and continue the current flow                                                                                                                                             | Oturumu kapat ve devam eden işleme devam et                                                                                                             |
| portal    | Settings                                                                                                                                                                         | Ayarlar                                                                                                                                                 |
| portal    | Sign in with a passkey                                                                                                                                                           | Geçiş anahtarıyla giriş yap                                                                                                                             |
| portal    | Switch User                                                                                                                                                                      | Kullanıcı Değiştir                                                                                                                                      |
| portal    | Toggle password visibility                                                                                                                                                       | Şifreyi göster veya gizle                                                                                                                               |
| portal    | Warning                                                                                                                                                                          | Uyarı                                                                                                                                                   |
| portal    | You have made too many requests                                                                                                                                                  | Çok fazla istekte bulundunuz                                                                                                                            |
| portal    | You must view and accept the Privacy Policy before using {{authelia}}. (value: `<policy>Privacy Policy</policy>`)                                                                | {{authelia}} hizmetini kullanmadan önce <policy>Gizlilik Politikasını</policy> görüntüleyip kabul etmeniz gerekir                                       |
| portal    | or                                                                                                                                                                               | veya                                                                                                                                                    |
| settings  | Caps Lock is on                                                                                                                                                                  | Caps Lock açık                                                                                                                                          |
| settings  | Change Password                                                                                                                                                                  | Şifreyi Değiştir                                                                                                                                        |
| settings  | Cross-Platform                                                                                                                                                                   | Platformlar Arası                                                                                                                                       |
| settings  | Delete                                                                                                                                                                           | Sil                                                                                                                                                     |
| settings  | Email One-Time Code                                                                                                                                                              | E-posta ile Tek Seferlik Kod                                                                                                                            |
| settings  | Email                                                                                                                                                                            | E-posta                                                                                                                                                 |
| settings  | Edit                                                                                                                                                                             | Düzenle                                                                                                                                                 |
| settings  | Edit WebAuthn Credential                                                                                                                                                         | WebAuthn Kimlik Bilgisini Düzenle                                                                                                                       |
| settings  | Failed to get session elevation status                                                                                                                                           | Oturum yükseltme durumu alınamadı                                                                                                                       |
| settings  | Incorrect password                                                                                                                                                               | Yanlış şifre                                                                                                                                            |
| settings  | In order to perform this action, policy enforcement requires that two-factor authentication is performed                                                                         | Bu işlem için güvenlik politikası iki faktörlü kimlik doğrulama yapılmasını gerektiriyor                                                                |
| settings  | Information                                                                                                                                                                      | Bilgi                                                                                                                                                   |
| settings  | New Password / Old Password / Password / Repeat New Password                                                                                                                     | Yeni Şifre / Eski Şifre / Şifre / Yeni Şifre (Tekrar)                                                                                                   |
| settings  | Passwords do not match                                                                                                                                                           | Şifreler eşleşmiyor                                                                                                                                     |
| settings  | Password changed successfully                                                                                                                                                    | Şifre başarıyla değiştirildi                                                                                                                            |
| settings  | Platform                                                                                                                                                                         | Platform                                                                                                                                                |
| settings  | Security                                                                                                                                                                         | Güvenlik                                                                                                                                                |
| settings  | Select a Method                                                                                                                                                                  | Bir Yöntem Seçin                                                                                                                                        |
| settings  | Submit                                                                                                                                                                           | Gönder                                                                                                                                                  |
| settings  | The decision to disable WebAuthn Credentials when Multi-Factor Authentication is enabled significantly undermines security and is highly inadvisable                             | Çok faktörlü kimlik doğrulama etkinken WebAuthn kimlik bilgilerini devre dışı bırakmak güvenliği ciddi biçimde zayıflatır ve kesinlikle önerilmez       |
| settings  | There was an issue changing the password                                                                                                                                         | Şifre değiştirilirken bir sorun oluştu                                                                                                                  |
| settings  | There was an issue retrieving configuration                                                                                                                                      | Yapılandırma alınırken bir sorun oluştu                                                                                                                 |
| settings  | This is disabled by your administrator                                                                                                                                           | Bu özellik yöneticiniz tarafından devre dışı bırakılmış                                                                                                 |
| settings  | Toggle new / old / repeat new password visibility                                                                                                                                | Yeni şifreyi / Eski şifreyi / Yeni şifre tekrarını göster veya gizle                                                                                    |
| settings  | Username / Name / WebAuthn                                                                                                                                                       | Kullanıcı adı / Ad / WebAuthn                                                                                                                           |
| settings  | WebAuthn Credentials are widely considered the most secure means of authentication, regardless of if they're used for Multi-Factor Authentication or Passwordless Authentication | WebAuthn kimlik bilgileri, çok faktörlü ya da şifresiz kimlik doğrulama için kullanılsın, genel olarak en güvenli kimlik doğrulama yöntemi kabul edilir |
| settings  | You can only register a single One-Time Password                                                                                                                                 | Yalnızca bir Tek Seferlik Şifre kaydedebilirsiniz                                                                                                       |
| settings  | You cannot reuse your old password                                                                                                                                               | Eski şifrenizi yeniden kullanamazsınız                                                                                                                  |
| settings  | Your administrator has disabled WebAuthn preventing you from registering WebAuthn Credentials including Passkeys                                                                 | Yöneticiniz WebAuthn’u devre dışı bıraktığı için geçiş anahtarları dahil WebAuthn kimlik bilgisi kaydedemezsiniz                                        |
| settings  | Your supplied password does not meet the password policy requirements                                                                                                            | Girdiğiniz şifre, şifre politikasının gereksinimlerini karşılamıyor                                                                                     |
| consent   | Accept this consent request / Deny this consent request                                                                                                                          | Bu onay isteğini kabul et / Bu onay isteğini reddet                                                                                                     |
| consent   | An error occurred processing the request                                                                                                                                         | İstek işlenirken bir hata oluştu                                                                                                                        |
| consent   | Code / Confirm the Code / Enter the code displayed on your device / Failed to submit the user code                                                                               | Kod / Kodu Onaylayın / Cihazınızda görüntülenen kodu girin / Kullanıcı kodu gönderilemedi                                                               |
| consent   | Consent has been accepted and processed / …rejected and processed                                                                                                                | Onay kabul edildi ve işlendi / Onay reddedildi ve işlendi                                                                                               |
| consent   | Debug Information / Description / Documentation / Error / Error Code / Hint / Required                                                                                           | Hata Ayıklama Bilgisi / Açıklama / Belgeler / Hata / Hata Kodu / İpucu / Zorunlu                                                                        |
| consent   | Hide request details / Show request details / Return to the consent request                                                                                                      | İstek ayrıntılarını gizle / İstek ayrıntılarını göster / Onay isteğine dön                                                                              |
| consent   | Information Shared / Requested Permissions / Requested Resources / Token Audience                                                                                                | Paylaşılan Bilgiler / İstenen İzinler / İstenen Kaynaklar / Belirteç Hedef Kitlesi                                                                      |
| consent   | The actions the application will be allowed to perform on your behalf                                                                                                            | Uygulamanın sizin adınıza yapmasına izin verilecek işlemler                                                                                             |
| consent   | The information about you the application will receive                                                                                                                           | Uygulamanın sizinle ilgili alacağı bilgiler                                                                                                             |
| consent   | The protected resources the application intends to access                                                                                                                        | Uygulamanın erişmek istediği korumalı kaynaklar                                                                                                         |
| consent   | The services the issued tokens will be valid for                                                                                                                                 | Verilen belirteçlerin geçerli olacağı hizmetler                                                                                                         |
| consent   | You may close this tab or return home by clicking the home button                                                                                                                | Bu sekmeyi kapatabilir ya da ana sayfa düğmesiyle ana sayfaya dönebilirsiniz                                                                            |
| consent   | You must reauthenticate to be able to give consent                                                                                                                               | Onay verebilmek için yeniden kimlik doğrulaması yapmanız gerekiyor                                                                                      |
| consent   | You will be asked to review the request next                                                                                                                                     | Ardından isteği incelemeniz istenecek                                                                                                                   |
| consent   | scopes.authelia.pam ("Authenticate to a Linux system as you")                                                                                                                    | Bir Linux sistemine kendi kimliğinizle giriş yapın                                                                                                      |

Corrections Lamaste applies over Authelia's `tr-TR` (D5 — the reviewer may
add to this list; each one is also offered to Authelia's translators):

| Key                                           | Authelia 4.39.28 `tr-TR`                  | Lamaste                                      |
| --------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Powered by {{authelia}}                       | Tarafından desteklenmektedir {{authelia}} | {{authelia}} tarafından desteklenmektedir    |
| Must be at least {{len}} characters in length | {{len}} karakter uzunluğunda olmalıdır    | En az {{len}} karakter uzunluğunda olmalıdır |
| Failed to revoke the One-Time Code            | Tek Seferlik Kodu iptal edemedim          | Tek Seferlik Kod iptal edilemedi             |

The `<noscript>` rewrite (§3): "Bu uygulama için tarayıcınızda JavaScript etkin olmalıdır."

## Core: the catalogue

- `packages/core/lib/src/page-messages.ts`, **browser-safe** (no node
  built-ins), exported as a new subpath `@lamalibre/lamaste/page-messages`
  (as `./branding`, `./domains`, `./invitation-limits`), so the panel's
  language picker and the branding preview import the languages and texts
  instead of copying them.
- `PAGE_LANGUAGES = ['en', 'tr'] as const`, `PageLanguage`, their own names
  (`English`, `Türkçe`), `isPageLanguage`.
- Typed catalogues: `const EN = { … } as const satisfies Record<string, string>`;
  `type PageMessageKey = keyof typeof EN`; `const TR: Record<PageMessageKey, string>` —
  a missing Turkish key is a **compile error**. Grouped by page so each page
  embeds only its own keys (`INVITE_PAGE_KEYS`, `INVITATIONS_PAGE_KEYS`, …).
- `formatMessage(text, values)` for `{name}` placeholders (server side;
  the page script has the same twelve-line function), `pluralKey(lang, n)`
  through `Intl.PluralRules`.
- The Authelia supplement and corrections live beside it
  (`AUTHELIA_SUPPLEMENT[lang][namespace]`, `AUTHELIA_CORRECTIONS[…]`), with
  `renderForcedAutheliaLocale(namespace, lang, embedded, supplement)`.
- Unit tests: every language has every key (also at runtime, for the JSON);
  every entry's placeholders equal English's (one listed exception: the
  Turkish e-mail body leaves out `{admin}`, §8.3); no control, bidi or invisible
  characters and no `<`, `>` outside Authelia's own tags; every page renders
  `lang`, its title and its data block in each language; **the script and
  style hashes are identical for every language and brand** (the invariant
  the CSP rests on); the data block cannot be ended by any catalogue text;
  the Authelia supplement covers exactly the keys `tr-TR` lacks in the pinned
  fixtures (none missing, none Authelia already has unless listed as a
  correction), keeps `{{…}}` and `<policy>` intact, and the forced file for
  `tr` contains every `en` key; Authelia contract pins (detection order,
  namespaces, `#language-button`, `<html lang="`, the `<noscript>` text).

## Operator surfaces

- **API**: `PUT /api/domains/:name/language { language: 'en' | 'tr' | null }`
  (admin): 400 `invalid_language`, 404 unknown domain; answers the domain with
  `warnings` when the rendering or the vhost could not be brought along (as
  branding does; the reconcile retries). `GET /api/domains` lists `language`.
  Audit `domain.language.updated` `{ domain, from, to }`.
- **Panel**: Domains page, per domain card: a Language select ("Not set —
  English pages, sign-in follows the browser", English, Türkçe), beside
  Branding; the branding preview shows the sign-in title in the domain's
  language.
- **AdminClient**: `setDomainLanguage(name, language)`; web client, desktop
  JS and Rust (`admin_set_domain_language`, body on curl's stdin).
- **CLI**: `lamaste-server domains language <domain> [en|tr|--unset]`
  (prints the current value without an argument; `--json`).
- **Docs**: `04-api-reference/domains.md` (Language), `invitations.md` (codes),
  `gatekeeper.md` (projection field), `03-architecture/nginx-configuration.md`
  (forced locales, `lang` rewrite, web-surface error page),
  `01-concepts/security-model.md` (the data block), CHANGELOG, CLAUDE.md line.

## Security notes

- Nothing the operator types reaches a page through the catalogue: the
  language is one of a closed list, validated in core and again by the
  vhost generator (it is interpolated into a root-validated file). Catalogue
  texts are Lamaste's, reviewed, and escaped like any other text.
- The data block is JSON with `<`, `>`, `&`, U+2028/9 escaped; the script
  treats every message as text (`text()`/`textContent`), except the few
  templates that wrap an escaped value in `<strong>`, which the script builds
  itself around the escaped value.
- The CSP is unchanged in shape and still one hash pair per page per release.
- The forced locale location serves only files the panel rendered; its regex
  admits only Authelia's locale grammar and three namespaces.
- `sub_filter` values are literals without `$`; `lamaste-priv` keeps refusing
  `$` in them.
- Gatekeeper's language read cannot weaken membership: it never invalidates
  the projection.

## Upgrade in place

- Migration `0021`: every domain unset → no visible change.
- At the first start: the stock pages are rewritten (their markup now holds
  the data block — English text unchanged), every rendering re-renders once
  (`pagesDigest`), every auth vhost is compared by the start's vhost reconcile
  (the CSP hashes change with the script) and rewritten; web-surface vhosts
  gain the error page (rewritten by `reconcileWebSurfaces`).
- `lamaste-priv` (root-owned, installed by create-lamaste) must accept the new
  vhost text before the new panel writes it: the Panel Update's redeploy
  installs the new `lamaste-priv` first, as for 4.8's `sub_filter`. A relay
  updated otherwise (panel package alone) fails the vhost write with a
  `warning` and keeps the old vhost — never a broken nginx.
- Gatekeeper and the panel ship together; either order works (the projection
  field is optional both ways).
- Downgrade to 4.9: the column is ignored, renderings with `language` are
  re-rendered by 4.9's reconcile (its digest differs), pages English again.

## Proof (rodeo)

- **Three-VM, new spec 56 `page-language`** (on `invitation-harness.sh`, the
  4.9 fixtures): domain A branded and `tr`, domain B unbranded and `en`,
  domain C unset. Asserts per domain: P1 and P2 `lang`, title, data block
  language and a sample of keys; the CSP header equal on A, B, C; Authelia's
  index `lang="tr" data-authelia-lang=…` on A, untouched on C; `/locales/en/portal.json`,
  `/locales/de-AT/portal.json` and `/locales/tr/portal.json` on A all Turkish
  (a supplemented key — "Yükleniyor" — and a correction present), on B all
  English, on C Authelia's own per locale; `brand.css` on A hides the menu, on
  C absent; an invitee refused on A gets P6 in Turkish (title, `lang`,
  templates), on B in English; a non-member on A gets P7 in Turkish; the
  plugin's site with its surface withdrawn answers P8 in Turkish on A; a
  revoked invitation's lookup answers `invitation_closed` (the code, the page
  is static); changing A to unset re-renders (Authelia's own files again) and
  the audit has both changes.
- **Single-VM, new spec 39 `page-language-validation`**: the API's refusals
  (`invalid_language`, unknown domain), `null` clears, the CLI, the vhost
  through `lamaste-priv`, the reconcile after a restart and after a tampered
  `rendered.json`, every new error code on `/api/invite/*` and
  `/api/delegated-invitations/*`.
- **Upgrade suite `01`**: after the Panel Update from 4.9.0, an unset domain's
  pages are English with the new CSP hashes, a 4.9 branded domain re-rendered
  once, a pending 4.9 invitation still opens.
- Not proven by rodeo (curl runs no script): the page scripts' rendering of
  the data block — the wave-4 browser pass covers it against a local preview
  of both pages in both languages, as 4.9's did against mocks.

## Waves

One agent per wave; each wave builds, lints, formats and tests before it
reports; the coordinator verifies and asks before the next.

0. **This document**, its independent review, and an independent reading of
   the Turkish (§8) by a reviewer who sees only the tables and the
   principles. Fixes folded in before wave 1.
1. **Core**: `page-messages.ts` + subpath, the catalogue (EN, TR), the pages
   rendering with a language and the data block, `authPagesDigest` over every
   language, the Authelia supplement/corrections and `renderForcedAutheliaLocale`,
   `renderAuthBranding` with `brand | null` and `language`, the projection's
   `language`, full Authelia fixtures, unit tests (incl. the hash invariant).
2. **serverd + Gatekeeper + nginx**: migration `0021`, the language route,
   audit, rendering triggers and reconcile, the auth vhost (forced locales,
   `lang`/`noscript` rewrite, stylesheet), the web-surface error page, error
   codes on both public APIs, the projection writer; Gatekeeper templates with
   `language` and the copy-button fix; `lamaste-priv` allow-list and tests.
   Gatekeeper builds clean (`rm -rf dist` first: its `build` copies its
   migrations with `cp -R`, which nests on a second run).
3. **Panel, CLI, desktop, docs**: Domains page select, AdminClient + both
   clients + Rust, CLI, API reference and concept docs, CHANGELOG, version
   **4.10.0** across the lockstep packages.
4. **Turkish review on the real pages + browser pass**: the reviewer reads the
   rendered pages (screenshots of P1, P2, P6, P7, P8 in `tr`), the built-in
   browser runs both page scripts against a local preview in both languages;
   fixes.
5. **Rodeo**: specs 56, 39, upgrade 01 on fresh VMs, against the 4.10.0
   candidate on the dev Feria; logs committed.

Then the PR to `develop`, reviewed and merged by rebase as #1–#4. No tag, no
publish, no change on the live relay: those are the founders'.

## Decisions (to agree)

| #   | Question                                 | Recommendation                                                                                                                          | Alternatives                                                                                       |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| D1  | Where the language lives                 | `domains.language` (migration 0021), a property of the domain                                                                           | a field of the brand record (a language would need a brand); one language for the relay            |
| D2  | Values and "unset"                       | `en`, `tr`, or unset; unset = today's behaviour; set = every page on the domain, Authelia included                                      | a non-null default `en` that forces English on every domain at upgrade                             |
| D3  | `Accept-Language`                        | No part                                                                                                                                 | domain default, negotiated among the catalogue's languages (Lamaste's pages only, or Authelia too) |
| D4  | Authelia                                 | Forced per domain: regex location serving one rendered file per namespace, menu hidden, `lang` and `<noscript>` rewritten               | leave Authelia on the browser (mixed languages on one domain); override only `en`                  |
| D5  | Authelia's Turkish gaps                  | Supplement all missing keys of the three namespaces + three corrections; pinned by fixtures; offered upstream                           | portal only; no corrections                                                                        |
| D6  | How static pages get their words         | A JSON data block in the markup; one script, one CSP hash pair per release                                                              | a per-domain `messages.json` fetched by the script; a script per language (two hash pairs)         |
| D7  | API refusals                             | Codes on every refusal of `/api/invite/*` and `/api/delegated-invitations/*`; `error` stays English; pages map codes                    | the panel localises `error` by the request's domain                                                |
| D8  | Gatekeeper's source of the language      | The projection `domains.json`, optional field, read leniently                                                                           | the rendering's `brand.json` (would need one for unbranded domains)                                |
| D9  | The rendering                            | One per domain with a brand or a language                                                                                               | shared per-language stock renderings for unbranded domains                                         |
| D10 | nginx's stock 503/403 on a plugin's site | Replaced by a Lamaste page in the domain's language                                                                                     | leave nginx's pages (English, unbranded)                                                           |
| D11 | Access-request message templates         | In the domain's language                                                                                                                | always English (the administrator's language)                                                      |
| D12 | Formats                                  | `{name}` placeholders, `Intl.PluralRules`, dates in the page's language, `novalidate` + own messages, no suffix on an interpolated name | browser-locale dates (today)                                                                       |
| D13 | Branch, version, proof                   | `feat/page-language` off `develop`, **4.10.0**, waves above, specs 56 + 39 + upgrade 01                                                 | 4.9.1 (it is a feature, not a fix)                                                                 |
