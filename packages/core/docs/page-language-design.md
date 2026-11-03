# Page Language — Design Document

> **Status:** 2026-11-03, reviewed. Wave 0 (inventory and design) done; waves 1 (core), 2 (serverd, nginx, the Authelia browser spike), 3 (Gatekeeper, the API codes) and 4 (panel, CLI, desktop, docs, 4.10.0) built, waves 5–6 to come. An independent review of the design against the code and Authelia v4.39.28, and an independent reading of the Turkish (§8), are both done and folded in (see _Review findings_ at the end). Decisions D1–D13 agreed by the founders on 2026-11-03, all as recommended (D3 the domain decides, D4 Authelia forced with its menu hidden, D11 templates in the domain's language, D13 4.10.0 asked explicitly).
> **Wave 1 (core) built 2026-11-03:** `page-messages.ts` (subpath `./page-messages`; EN/TR catalogue of §8, typed; per-page key lists; one-pass `formatMessage`/`formatMessageHtml` — the latter also turns the one `[…]` span of `refusal.signOut` into the sign-out link —, `pluralKey`, `htmlAsciiReferences`, `pageMessagesJson`, `escapeHtml`), `authelia-locales.ts` (root, browser-safe: the portal contracts, the supplement and corrections of §8.4, `renderForcedAutheliaLocale`, `autheliaIndexLanguageFilters` — the `sub_filter` pairs wave 2 writes), `server/unavailable-page.ts` (P8: `renderUnavailablePage`, `UNAVAILABLE_PAGE_STYLE_HASH`, `unavailablePageHeaders(domain)` for the vhost), the invite and inviter pages in a language (one script each, its shared helpers `AUTH_PAGE_SCRIPT_WORDS`; never `data.error`; `novalidate`; Revoke by `data-confirm`), `renderAuthBranding` with `brand | null` and `language` (writes `unavailable/index.html` for every rendering), the projection's lenient `language` (`DomainsIndex.languages`, `domainLanguageOfHost`), verbatim Authelia 4.39.28 fixtures and 4.9.0 page fixtures for the regression pin. Built differently from the text below: the data block is `{"lang":…,"messages":{…}}` (not flat); the supplement and corrections live in `authelia-locales.ts`, not beside the catalogue; `renderForcedAutheliaLocale` takes `{ namespace, language, english, embedded }` and returns `{ messages, fromEnglish }` (the brand is spliced by the caller); `rendered.json` records `language` and `autheliaPinned` (the pin) beside `autheliaVersion`, which is whatever the caller passes — wave 2 passes the running version; English `template.chat` keeps 4.9's backticks (`` `{resource}` ``), the Turkish is the reviewed text without them; the inviter's page shows a refused revocation above its list. The auth-vhost pieces stay in serverd (`nginx.js`) for wave 2. Wave 3 note: 4.9's Gatekeeper explanations break a sentence across a line inside the HTML; the catalogue holds each on one line, so the English regression pin compares whitespace-collapsed text.
> **Wave 2 (serverd, nginx) built 2026-11-03:** migration `0021_domain_language.sql`; `PUT /api/domains/:name/language` (`lib/domains.js` `setDomainLanguage`: domains lock → domain rendering → branding mutex; 400 `invalid_language`, 404 `domain_not_found`, `warnings` `gatekeeper|render|vhost`; audit `domain.language.updated {domain, from, to}`; Authelia never rendered again nor restarted); `GET /api/domains` lists `language`, a `rendering` per domain (`rendered`, `current`, `renderFailing`, `vhostPending`) and `authelia: {running, pinned}`; the projection writer (`writeDomainsProjection`) carries `language` only when set (version stays 2). `lib/auth-branding.js`: the running Authelia's version read from its binary (`authelia --version`, cached with the locales for 10 min, the locales fetched again when it changes), recorded in `rendered.json`, flagged once per version (audit `authelia.version.unpinned {running, pinned}` + one notification, remembered across restarts through the audit log); renderings for a brand **or** a language (`renderInputs`, `renderingCurrent` compares revision, language, running version, pages digest); removing a brand keeps a language-only rendering; `authVhostInputs` (replaces `authVhostBranding`) feeds every auth-vhost writer — branding changes, `applyDomainLanguage`, activation, the start's vhost reconcile, onboarding; a removed domain's language-only rendering goes with it. `lib/nginx.js`: the forced-locale regex location and the `lang`/`noscript` `sub_filter`s exactly as §3, the stylesheet linked for a brand or a language; P8 as §2 (`error_page 503 /internal/lamaste/unavailable`, internal location on the rendering, `@unavailable` on the stock copy — named without a hyphen, lamaste-priv's named-location rule); the stock page written at start and at onboarding (`writeUnavailablePage`). **lamaste-priv needed no change**: its tests now accept the exact lines (the quoted regex, the character-reference `noscript`, the P8 locations) and refuse the raw Turkish, a backslash regex and a variable. Regression pins against 4.9.0's own output (`test/fixtures/lamaste-4.9.0/`, rendered by 4.9.0's code): an unset domain's auth vhost (unbranded and branded) differs only in the CSP hashes; a served web surface is byte for byte the same; a not-served one differs only by the page's lines. **The browser spike passed** (§3, _Spike result_).
> **Wave 3 (Gatekeeper, API codes) built 2026-11-03:** Gatekeeper's pages from the core catalogue in the language `pageOptions` reads from the projection (`DomainsIndex.languages` of the host's domain; none set, an unknown value or a host under no domain = English): `TemplateOptions.language`; the access-request page (P6: `lang`, title, sentences, `Subject:`, both administrator-name keys, the message templates in the domain's language — D11) and the domain refusal page (P7: the sign-out link by `formatMessageHtml`'s `[…]`); the copy buttons carry `data-label`/`data-copied` and copy the template's own element (`templateBox`), so the script is one text for every language; P9 is `buildForbiddenPage` — every refusal of `/authz/user-surface-shell/:fqdn` but 401 and the access-request page's (`not_served`, a malformed or mismatched request, not a web surface) answers it, in the brand and language of the domain the path names; `GET /access-request` removed (nothing referenced it; `authorization.md` row dropped); `getAccessRequestTemplates` (JSON, `checkAccess`) stays English, built from the English catalogue, Teams' template literal. API codes: `invitation_not_found` (lookup/accept 404), `invitation_used`, `invitation_expired`, `invitation_closed` (revoked; also `claimInvitationSync` and a refused claim — `invitationClosedError`), `username_unavailable` on an administrator's invitation whose username is taken, `not_found` on the inviter's API (route checks, a bad id, revoking none — the inviter's page's key, so not `invitation_not_found` there as §6's table had it). Tests: Gatekeeper `page-language.test.js` (the English pin against 4.9.0's pages rendered by `d5bc67f1`'s code, `test/fixtures/lamaste-4.9.0/`: same text, style, links and classes, the button labels; only the copy buttons' markup and `'` → `&#039;` differ — `formatMessageHtml` escapes every text), `authz-page-language.test.js` (the routes, the lenient projection); serverd `invitation-refusal-codes.test.js` reads every refusal of the two APIs' files from source (`httpError`, `reply.code(…).send`, `resolveUserCaller`) and fails on one whose code its page's catalogue lacks, unless listed as answered by its status or as the administrators' API. Docs: `invitations.md` (codes; the pages never show `error`), `gatekeeper.md` (P9, the language, the removed route).
> **Wave 4 (operator surfaces, docs, version) built 2026-11-03:** `AdminClient.setDomainLanguage(name, language)` and the listing's types (`DomainView.language`, `DomainRenderingView`, `AutheliaVersionsView` on `getDomains`); the web client (`PUT …/language`), the desktop JS client and Rust `admin_set_domain_language` (body on curl's stdin, registered in `main.rs`). Panel: each domain card's **Language** section (`components/DomainLanguage.jsx`, words in `admin/lib/language.js`: not set / English / Türkçe from `page-messages`, applied by a button, `warnings` as warning toasts, the rendering's state; keyed by the domain's language so a change made elsewhere resets the choice), the card's subtitle names a set language, the Domains page warns when the running Authelia is not the pin (`useDomains` exposes `authelia`). The branding preview speaks the domain's language: serverd `getDomainBrandingPreview` takes the title and footer from the forced portal file (`renderForcedAutheliaLocale`, brand-spliced) and the stylesheet from `renderDomainCss` — `DomainBrandingPreview.locale` is a `PageLanguage`. CLI: `lamaste-server domains language <domain> [en|tr|--unset]` (pure helpers `languageRequest`, `languageText`, `renderingText`, `autheliaVersionText` in `src/domains.js`; the panel decides which languages exist), `domains list` names a set language and the unpinned Authelia. Docs: `domains.md` (Page language, the listing, the rendered files, the preview, the CLI), `nginx-configuration.md` (the forced-locale location, the `lang`/`noscript` filters, the P8 locations), `security-model.md` (A domain's page language), the second-domain guide's step 7, CHANGELOG `[Unreleased]`, the CLAUDE.md bullet. `chore(release): 4.10.0 candidate` mirrors 4.9.0's file set (25 files; the lockfile's 31 version lines edited, not regenerated — this npm would also drop every `"peer": true`).
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

| #   | Page                                                                                                                                                                                                                                                          | Served by                                                                                                                                              | Text sources today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | In scope                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| P1  | Inviter's page `auth.<d>/invitations/<route>`                                                                                                                                                                                                                 | static file: core `server/invitations-page.ts` (`renderInvitationsPage`), the domain's rendering or the stock copy (`/var/www/lamaste/invitations`)    | shell (`<title>`, loading text, `lang="en"` in `auth-pages.ts`); ~40 strings in the inline script (headings, labels, hints, the bounds sentence with a plural, the link notice, Copy/Copied/Selected, the status words, Revoke/Really revoke?); the API's `error` texts shown verbatim (`errorOf`); dates by `toLocaleString(undefined, …)` (the browser's locale, not the page's); the browser's own `required`/`type=email` validation bubble                                                                                                                                      | yes                                                                               |
| P2  | Invitation page `auth.<d>/invite#<token>` (both kinds)                                                                                                                                                                                                        | static file: core `server/invite-page.ts` (`renderInvitePage`), rendering or stock (`/var/www/lamaste/invite`)                                         | shell; ~35 strings in the inline script (incl. the username rule with its bounds, password rules, the two-factor notice, the QR `alt`); the API's `error` texts shown verbatim (`lookup`/`accept`); dates as P1                                                                                                                                                                                                                                                                                                                                                                      | yes                                                                               |
| P3  | Authelia sign-in, second factor (one-time password), "authenticated", sign-out                                                                                                                                                                                | Authelia 4.39.28 at `auth.<d>/`, index HTML rewritten by the auth vhost (`autheliaIndexRewrite`)                                                       | `/locales/<lang>/{portal,settings,consent}.json` (i18next); the index HTML's `<html lang="…">` and `<noscript>` text (Go template, `web/index.html`)                                                                                                                                                                                                                                                                                                                                                                                                                                 | yes, by configuration (§3)                                                        |
| P4  | Authelia account settings (reached from the sign-in app bar once signed in)                                                                                                                                                                                   | Authelia                                                                                                                                               | `settings` namespace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | yes, same mechanism                                                               |
| P5  | Authelia OIDC consent                                                                                                                                                                                                                                         | Authelia                                                                                                                                               | `consent` namespace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | not on these paths; covered by the same files                                     |
| P6  | Access-request page (restricted tunnel/site, not in the plugin's audience, external member not granted)                                                                                                                                                       | Gatekeeper, inline (`buildAccessRequestPage`) — on tunnel hosts (`/internal/lamaste/authz`) and on the plugin's site (`/internal/lamaste/shell-authz`) | ~15 strings, the message templates (e-mail subject/body, Slack/Teams, WhatsApp, generic), "Admin:"/"Help:", the default `adminName` ("Administrator", "your administrator"), the copy script's Copy/Copied — whose `textContent.replace(/Copy$/, '')` assumes the English label; the e-mail box's `Subject:` prefix; the salutation default "Administrator" (distinct from "your administrator" in the sentences). Gatekeeper's standalone `GET /access-request` route renders the same page without `pageOptions` (no brand, no language) and nothing links to it: removed (wave 3) | yes                                                                               |
| P7  | Domain refusal page (signed in, not a member; a static site that refused)                                                                                                                                                                                     | Gatekeeper, inline (`buildDomainRefusalPage`, three variants)                                                                                          | ~10 strings, the sign-out sentence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | yes                                                                               |
| P8  | The plugin's site when its web surface is not served                                                                                                                                                                                                          | the web-surface vhost (`renderWebSurfaceVhost`, `return 503`) — **nginx's stock error page**                                                           | "503 Service Temporarily Unavailable … nginx", English, unbranded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | yes — replaced by a static Lamaste page, "unavailable" (D10, §2)                  |
| P9  | The plugin's site when Gatekeeper refuses the shell with an empty 403 (`refuse('not_served')`, a malformed request — `gatekeeper/src/server/routes/authz.ts`)                                                                                                 | `error_page 403 = /internal/lamaste/shell-authz` re-asks Gatekeeper, whose empty body passes through → **a blank page**                                | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | yes — Gatekeeper renders a "not allowed" page in `refuse('not_served')` (D10, §7) |
| P10 | The plugin's own shell and API answers                                                                                                                                                                                                                        | the plugin                                                                                                                                             | the plugin's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **no** — the plugin translates its UI; Lamaste's JSON stays a contract (D7)       |
| P11 | JSON bodies nginx, Gatekeeper and the panel write for scripts: `{"error":"unauthenticated"}`, `{"error":"forbidden"}`, `{"error":"not_a_member"}`, `userSurfaceErrorText`; the message templates `checkGrant` returns as JSON (`gatekeeper/src/lib/authz.ts`) | nginx `return …`, Gatekeeper, core `agent-forwarder.ts`                                                                                                | API contract (the JSON templates stay English: a script, not a person, reads them)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **no** — codes, not prose; the pages and plugins map them (D7)                    |

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

Six pages Lamaste owns are translated (P1, P2, P6, P7, the new static P8 page
and Gatekeeper's new P9 page); Authelia's portal (P3–P5) is put in the domain's language by
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
  namespace with one rendered file can. Authelia routes only
  `/locales/{language:[a-z]{1,3}}[-{variant:[a-zA-Z0-9-]+}]/{namespace:[a-z]+}.json`
  and the list `GET /locales` (`internal/server/handlers.go`), which only the
  language menu requests. The i18next backend's `loadPath` is
  `basePath + "/locales/{{lng}}/{{ns}}.json"`, with `supportedLngs`,
  `nonExplicitSupportedLngs: true`, `load: "all"` and `fallbackLng.default:
["en"]` (`web/src/i18n/index.ts`), so every file it asks for has that shape
  (read from the config; a browser proves it — wave 2's spike, §3).
- **Dates** in the settings namespace (`{{when, datetime}}`, four keys) are
  formatted by i18next in the _detected_ language, not the file's: a forced
  Turkish sentence can carry the browser's month names (a known gap, D4).
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
moves one fails the build. (The existing locale fixtures are excerpts; wave 1
adds full verbatim copies of `en` and `tr-TR` for the three namespaces,
Apache-2.0, with their source URLs.)

**The running Authelia can be newer than the pin.** create-lamaste keeps a
newer Authelia and never downgrades it (`provisioners/server/src/lib/binaries.js`,
its database may already be newer), and 4.8's `rendered.json` records the pin
constant, not what runs (`server/daemon/src/lib/auth-branding.js`). On such a
relay the pinned contracts are unproven, so the build cannot be the only
guard:

- serverd reads the **running** version (`authelia --version`, execa with
  array arguments, `normaliseAutheliaVersion`) at start and before every
  rendering, and records it in `rendered.json` as `autheliaVersion` beside the
  pin; a change of the running version re-renders (the locale files are
  fetched from the running Authelia, as in 4.8).
- When it differs from the pin: audit `authelia.version.unpinned`
  `{ running, pinned }` and one admin notification per running version; the
  domains are still rendered — refusing would only take the language away.
- How it degrades, never to a broken page: a key the newer release added and
  Lamaste's supplement lacks is filled from that release's own `en` (§3, step
  3), so the visitor reads that sentence in English; a renamed menu id leaves
  the menu visible, choosing in it changes nothing (every locale path still
  yields the domain's file); a changed path grammar or namespace set makes the
  regex miss, the request falls to 4.8's `/locales/` prefix location and
  Authelia answers in the browser's language (mixed pages); a changed `lang`
  literal leaves `lang` the cookie's. The Domains page shows the warning with
  the versions until the pin catches up.

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

| Page   | How                                                                                                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1, P2 | rendered into the domain's rendering (§5) with `lang`, `<title>`, loading text and a JSON data block of messages (§4); the stock copies (unset domains) are English                                               |
| P3–P5  | the auth vhost serves the rendering's forced locale files and rewrites `lang` and `<noscript>` (§3)                                                                                                               |
| P6, P7 | Gatekeeper renders them server-side in the language of the host's domain, read from the projection `domains.json` (D8)                                                                                            |
| P8     | a static page in the domain's rendering (`unavailable/index.html`), English stock copy (`/var/www/lamaste/unavailable/index.html`) for a domain without a rendering; served by the web-surface vhost (D10, below) |
| P9     | Gatekeeper renders a "not allowed" page in `refuse('not_served')` and for a malformed shell request, in the host's domain's language and brand, as P6/P7 (D10, §7)                                                |

**P8 in nginx.** The not-served web-surface vhost keeps `return 503` and
names an internal page for it; nothing Turkish enters the vhost:

```nginx
    error_page 503 /internal/lamaste/unavailable;
    location / {
        add_header Cache-Control no-store always;
        add_header Clear-Site-Data '"storage"' always;   # as today, when it applies
        return 503;
    }
    location = /internal/lamaste/unavailable {
        internal;
        root /var/www/lamaste/auth/<domain>;
        try_files /unavailable/index.html @lamaste-unavailable;
        default_type text/html;
        add_header Cache-Control no-store always;
        add_header Clear-Site-Data '"storage"' always;   # when it applies
        add_header Content-Security-Policy "default-src 'none'; style-src 'sha256-…'; img-src https://auth.<domain>; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" always;
        add_header X-Content-Type-Options nosniff always;
    }
    location @lamaste-unavailable {
        root /var/www/lamaste/unavailable;
        try_files /index.html =503;
        # the same headers
    }
```

`error_page 503` without `=` keeps the status. The page cannot link
`/brand.css` (on the plugin's host every path answers 503), so its style is
inline and **one text for every brand and language**: one hash per release
(the stock look, with the brand's name and its logo from
`https://auth.<domain>/static/media/logo.png`, as Gatekeeper's pages show it).
It carries no script. The root is the rendering's link, so a rendering that
appears or goes needs no vhost rewrite: the named location answers for a
domain without one. Wave 2's tests: `nginx-vhosts.test.js` renders both
not-served vhosts (with and without `Clear-Site-Data`) and the served one
unchanged; `lamaste-priv.test.js` accepts `error_page 503 /internal/…`, the
internal location with `try_files … @lamaste-unavailable` and the CSP header,
and still refuses a `$` or non-ASCII byte in either; a unit test pins the
style hash and that the page's style is identical for every brand and
language.

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
    location ~ "^/locales/[^/]{1,64}/(consent|portal|settings)[.]json$" {
        root /var/www/lamaste/auth/<domain>;
        try_files /locales/forced/$1.json @authelia;
        add_header X-Content-Type-Options nosniff;
        add_header Cache-Control "public, max-age=0, must-revalidate";
    }
```

`[.]` rather than `\.`: `lamaste-priv` refuses any backslash in a vhost
(`scripts/lamaste-priv`, the tokenizer), and the web-surface vhost already
uses the same idiom (`WEB_SURFACE_SUBRESOURCE_RE`). The locale segment is
`[^/]{1,64}`, wider than Authelia's grammar, so even a path Authelia would
refuse yields the domain's file (a narrower regex would let such a path fall
to the 4.8 prefix location and Authelia's own language). It cannot catch
anything else: under `/locales/` Authelia serves only `<locale>/<ns>.json`,
the list `GET /locales` has no trailing segment, and the namespace group
admits only the three namespaces.

In the `/` location's index rewrite (beside the theme and logo filters):

```nginx
        sub_filter '<html lang="' '<html lang="tr" data-authelia-lang="';
        sub_filter 'You need to enable JavaScript to run this app.' 'Bu uygulama i&#231;in taray&#305;c&#305;n&#305;zda JavaScript etkin olmal&#305;d&#305;r.';
        sub_filter '</head>' '<link rel="stylesheet" href="/brand.css"></head>';
```

**Everything Lamaste writes into a vhost is ASCII.** `lamaste-priv`'s
tokenizer refuses any character outside `0x20–0x7e`, quoted strings included,
so the Turkish `<noscript>` sentence is written as HTML numeric character
references (`ç` = `&#231;`, `ı` = `&#305;`; quotes, `&`, `#` and `;` are
accepted inside a quoted token, `$` is not and never occurs). The generator
derives it from the catalogue with one function (`htmlAsciiReferences`, every
code point above `0x7e` → `&#<decimal>;`), and wave 2's
`lamaste-priv.test.js` accepts exactly the line above. No other Turkish goes
into a vhost: the P8 page is a file in the rendering (§2), P9 is Gatekeeper's
body, the CSP headers are ASCII.

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

**A browser proves it, before rodeo (wave 2).** Rodeo's curl shows what
nginx answers, not what the portal does with it. Wave 2 runs a spike on this
Mac: Authelia 4.39.28's official container image (`authelia/authelia:4.39.28`
under Docker — Authelia publishes no macOS binary) with a minimal file-backend
configuration, behind the Homebrew nginx carrying the generated auth vhost
locations and a rendered `tr` directory, driven by a Chromium whose locale is
set per context (`navigator.languages` = `de-AT`, `en-US`, `ar`), plus one run
with `localStorage['lang.preference'] = 'fr'`. Each run must show the sign-in
and second-factor screens in Turkish, no request answered by Authelia's own
locale files, `lang="tr"`, and no language menu. The spike's tools stay in the
scratchpad, not in the repository; its result and screenshots go in this
document.

**Spike result (2026-11-03).** Authelia 4.39.28's official image under
Docker, a minimal file-backend configuration (one invented user, one
`two_factor` rule for an invented host), Homebrew nginx 1.29.1 running the
auth vhost **as `renderAuthVhost` generates it** for a `tr` domain (only the
listen address, certificate and web-root paths rewritten for the Mac; `nginx
-t` accepted it unchanged otherwise), the rendering made by
`renderAuthBranding` from the locales `fetchAutheliaLocales` read from that
Authelia (327 files; `fromEnglish` empty). A real Chrome (headless, a fresh
profile per case, `--lang`/`--accept-lang`) opened the sign-in, signed in and
reached the second-factor screen:

| Case                                              | `navigator.languages` | Locale files the portal asked for                        | Sign-in and second factor                  |
| ------------------------------------------------- | --------------------- | -------------------------------------------------------- | ------------------------------------------ |
| `de-AT`                                           | `["de-AT"]`           | `de-AT`, `de`, `en` × 3 namespaces — all the forced file | Turkish, `lang="tr"`, menu `display: none` |
| `en-US`                                           | `["en-US"]`           | `en-US`, `en` × 3                                        | Turkish, `lang="tr"`, menu hidden          |
| `ar`                                              | `["ar"]`              | `ar`, `en` × 3                                           | Turkish, `lang="tr"`, menu hidden          |
| `localStorage['lang.preference'] = 'fr'`, `en-US` | `["en-US"]`           | `fr`, `en` × 3                                           | Turkish, `lang="tr"`, menu hidden          |

nginx's access log showed every `/locales/<x>/<ns>.json` answered 200 with
the forced file's exact size; none reached Authelia. The screens read
"Giriş yap", "Kullanıcı adı", "Şifre", "Beni hatırla", "Altyapı: Authelia"
(the correction) and, after signing in, "Merhaba …", "OTURUMU KAPAT |
KULLANICI DEĞİŞTİR | YÖNTEMLER" (upper-cased by CSS, the dotted `İ` right
because `lang="tr"`), "Tek Seferlik Şifre", "Cihaz kaydedin". One surprise,
harmless: the portal requests the language list `GET /locales` on every
load (twice), not only from the menu; Authelia answers it (the list of its
languages, no texts), and nothing the visitor reads comes from it.
Screenshots and the raw results stayed in the session's scratchpad, as the
spike's tools did, not in the repository.

Known gaps and trade-offs of forcing (D4):

- **Dates on the settings page** follow the browser's detected language
  (`{{when, datetime}}`), so a Turkish sentence may carry, say, German month
  names. Fixing it needs Authelia's cooperation (an i18next option the portal
  does not expose); recorded, not worked around.
- **No way out for a reader who does not read the domain's language**: the
  menu is hidden because it would change nothing. That is the point of a
  domain language (the operator chose it for the domain's people); a domain
  whose people are mixed leaves the language unset and Authelia follows each
  browser.

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
- **Formatting is one pass.** `formatMessage` (core and the script's copy)
  scans the template once and replaces each `{name}` by its value; a value is
  never scanned again, so a display name or role label holding `{plugin}`
  stays text. The few HTML templates (a value in `<strong>`) are built by
  escaping the template's own text and wrapping each escaped value in its
  element; every other message is set with `textContent`.
- **The pages never show the server's prose.** Not every refusal goes
  through `httpError` (`routes/delegated-invitations.js` sends its own
  "cross-site request refused", "Not found"; `lib/user-caller.js` its
  403/404/503), so a list of codes alone cannot be complete. The invariant is
  in the scripts: they never read `data.error` for display — a known `code`
  maps to the catalogue, anything else to the status's text (§6). A unit test
  checks the two scripts' source for any display use of `.error` and fails on
  one.
- **No control flow on a label.** The inviter's Revoke button confirms on a
  second click by a flag on the element (`data-confirm`), not by comparing
  `textContent` with `'Revoke'` (`invitations-page.ts` today); the access-request
  page's copy button likewise (§7).
- `<title>`, the loading text and `lang` are rendered server-side from the
  same catalogue, **escaped**: `authPageShell` writes `title` and `loading`
  unescaped today (`server/auth-pages.ts`), which was safe while they were
  constants in the code and is not once they come from a catalogue.
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

What 4.8's code assumes and wave 2 changes (`server/daemon/src/lib/auth-branding.js`):

- **The reconcile keeps only domains with a brand record** and would delete a
  language-only rendering; `renderedCurrent` compares the brand alone. Both
  take "brand or language": the set of domains to keep is those with a brand
  record or a language, and currency compares brand revision, language,
  running Authelia version and pages digest.
- **The vhost is rewritten only when the theme or the logo change.** The
  vhost's inputs become `{ branding, language }`: a language change rewrites
  it, and so does every other writer of an auth vhost — domain activation in
  `lib/domains.js` and the start's vhost reconcile pass the language too, so
  none of them writes a vhost that drops it.
- **Lock order:** the domain-rendering lock (`withDomainRendering`), then the
  branding mutex — as a brand change takes them. A language change touches no
  Authelia configuration and **never restarts Authelia**: it writes files, the
  projection and the vhost (an nginx reload).
- **Where an operator sees it:** `GET /api/domains` and the Domains page show,
  per domain, the language and the rendering's state (`current`, `pending`
  with its last error, the Authelia version warning of §"What Authelia can do"),
  for a language-only domain as for a branded one.

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
status (404, 409, 410, 429, 5xx, other), never the server's English (§4: the
scripts never display `data.error`, checked by a unit test on their source).
Codes are added where a person benefits from a precise sentence; a refusal
without one — the route's own "cross-site request refused", `resolveUserCaller`'s
answers, a framework 400 — still gets its status's text. A second unit test
lists every `httpError(` on these routes' paths and fails on one whose code
the pages' catalogue does not map.

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
- The default administrator names become the catalogue's: the salutation
  default ("Administrator", `access.defaultAdminSalutation`) and the one in
  sentences ("your administrator" → "yöneticiniz", `access.defaultAdmin`) are
  two keys, so English stays byte-for-byte what 4.9 renders; an operator-set
  name is shown as set. The e-mail box's `Subject:` prefix is a key too.
- **P9** — `refuse('not_served')` and the malformed-shell refusal answer 403
  with a "not allowed" page (catalogue `forbidden.*`) through the same
  `pageOptions` (brand and language of the host's domain), never cached; the
  user-surface routes keep their JSON (P11).
- **The standalone `GET /access-request` route is removed.** Nothing links to
  it (no vhost names it; the 403 pages are inline), it skips `pageOptions`, and
  it takes the username from a `Remote-User` header any local process can send
  to `127.0.0.1:9294`.
- The `teams` template and the JSON templates `checkGrant` returns stay as
  they are in English for JSON callers (P11); the HTML page renders its own
  templates from the catalogue.

### 8. Turkish copy

Principles for the reviewer:

- Formal throughout (**siz**): imperatives "girin", "seçin", "kopyalayın";
  questions "…mi?" addressed with siz.
- **Authelia's terms on the same screens win**, so the invitee meets one
  vocabulary. Read in 4.39.28's `tr-TR/portal.json`: "Sign in" → _Giriş yap_,
  "Sign out" and "Logout" → _Oturumu kapat_, "Password" → _Şifre_ (never
  _parola_), "Username" → _Kullanıcı adı_, "One-Time Password" → _Tek Seferlik
  Şifre_, "Time-based One-Time Password" → _Zaman Tabanlı Tek Seferlik Şifre_,
  two-factor → _iki faktörlü kimlik doğrulama_. (Authelia itself also says
  _oturum açma_ in three error sentences — "Güvenlik anahtarı oturum açma
  süreci başlatılamadı", "Oturum açma sürecini tamamlarken…"; Lamaste leaves
  those and uses _giriş yap_ everywhere it writes.)
- **Casing and forms**: headings and buttons in sentence case (Turkish UI
  convention). Buttons and links are short imperatives ("Kopyala", "Hesap
  oluştur", "Giriş yap", "İptal et", "Giriş sayfasına git"); headings are a
  noun phrase or a siz sentence ("Daveti kabul edin", "Erişim gerekli"); body
  text and errors use the siz form ("girin", "seçin"). Authelia's own
  Title-Case strings keep Authelia's casing on its screens. _Lütfen_ only in
  "try again" sentences, never in field validation.
- The plugin's vocabulary for people: _Davet_ (invitation), _Kişiler_
  (people), and role names as the plugin's manifest labels them (e.g.
  _Koordinatör_, _Üye_, _İzleyici_, _Kurucu_ in a Turkish plugin — Lamaste
  never writes a role name itself, it shows the label it is given).
- **Never put a suffix on an interpolated name**: vowel harmony depends on a
  word Lamaste does not know. A noun carries the suffix instead ("{plugin}
  uygulamasına", "{host} adresine", "{domain} alan adının"), or the name stands
  alone after a colon ("Hesabınız oluşturuldu: {username}").
- Usernames are ASCII (`a–z`, digits, `-`, `_`). A Turkish reader's alphabet
  from a to z includes _ç, ğ, ı, ö, ş, ü_, so "a–z arası" would not tell them
  those are refused: the hint and the rule name the refused letters instead.
- One field, one term: the name field is _ad soyad_ everywhere ("Adınız
  soyadınız", "Ad soyad geçersiz"); "expire" is _süresi dol-_ in sentences and
  _son geçerlilik tarihi_ as a label; Lamaste never says it _sends_ an
  invitation (it sends no mail) — it _creates_ one.
- Placeholders are `{name}` in Lamaste's catalogue and `{{name}}`, `<policy>`
  in Authelia's — kept verbatim.

#### 8.1 Lamaste's pages (P1, P2, P8, P9) — reviewed

| Key                                        | English                                                                                                              | Türkçe (reviewed)                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invite.title`                             | Accept Invitation                                                                                                    | Daveti kabul edin                                                                                                                                                             |
| `invite.loading`                           | Loading invitation…                                                                                                  | Davet yükleniyor…                                                                                                                                                             |
| `invite.invalidLink`                       | This invitation link is not valid.                                                                                   | Bu davet bağlantısı geçerli değil.                                                                                                                                            |
| `invite.unavailableTitle`                  | Invitation Unavailable                                                                                               | Davet kullanılamıyor                                                                                                                                                          |
| `invite.invitedTitle`                      | You’ve Been Invited                                                                                                  | Davet edildiniz                                                                                                                                                               |
| `invite.adminSubtitle`                     | Set your password to create your account.                                                                            | Hesabınızı oluşturmak için şifrenizi belirleyin.                                                                                                                              |
| `invite.delegatedBy`                       | {inviter} invited you to {plugin} as {role}.                                                                         | {inviter} sizi {plugin} uygulamasına {role} olarak davet etti.                                                                                                                |
| `invite.delegated`                         | You are invited to {plugin} as {role}.                                                                               | {plugin} uygulamasına {role} olarak davet edildiniz.                                                                                                                          |
| `invite.username`                          | Username                                                                                                             | Kullanıcı adı                                                                                                                                                                 |
| `invite.usernameHint`                      | You sign in with it. Lower-case letters, digits, - and \_; it cannot be changed later.                               | Giriş yaparken bu adı kullanacaksınız. Küçük harf, rakam, - ve \_ içerebilir; ç, ğ, ı, ö, ş, ü kullanılamaz. Daha sonra değiştirilemez.                                       |
| `invite.email`                             | Email                                                                                                                | E-posta                                                                                                                                                                       |
| `invite.expires`                           | Expires                                                                                                              | Son geçerlilik tarihi                                                                                                                                                         |
| `invite.yourName`                          | Your name                                                                                                            | Adınız soyadınız                                                                                                                                                              |
| `invite.password`                          | Password                                                                                                             | Şifre                                                                                                                                                                         |
| `invite.passwordHint`                      | At least 8 characters                                                                                                | En az 8 karakter                                                                                                                                                              |
| `invite.confirmPassword`                   | Confirm password                                                                                                     | Şifre (tekrar)                                                                                                                                                                |
| `invite.create`                            | Create Account                                                                                                       | Hesap oluştur                                                                                                                                                                 |
| `invite.creating`                          | Creating account…                                                                                                    | Hesap oluşturuluyor…                                                                                                                                                          |
| `invite.usernameRule`                      | A username has {min} to {max} lower-case letters, digits, - and \_, and starts with a letter or digit.               | Kullanıcı adı {min}–{max} karakter uzunluğunda olmalı; yalnızca küçük harf, rakam, - ve \_ içerebilir (ç, ğ, ı, ö, ş, ü kullanılamaz) ve bir harf ya da rakamla başlamalıdır. |
| `invite.nameRequired`                      | Enter your name.                                                                                                     | Adınızı ve soyadınızı girin.                                                                                                                                                  |
| `invite.passwordShort`                     | A password has at least 8 characters.                                                                                | Şifre en az 8 karakter olmalıdır.                                                                                                                                             |
| `invite.passwordLong`                      | A password has at most 128 characters.                                                                               | Şifre en fazla 128 karakter olabilir.                                                                                                                                         |
| `invite.passwordMismatch`                  | The passwords do not match.                                                                                          | Şifreler eşleşmiyor.                                                                                                                                                          |
| `invite.createdTitle`                      | Account Created                                                                                                      | Hesabınız oluşturuldu                                                                                                                                                         |
| `invite.created`                           | Your account {username} has been created.                                                                            | Kullanıcı adınız: {username}                                                                                                                                                  |
| `invite.scanQr`                            | Scan this QR code with your authenticator app to set up two-factor authentication.                                   | İki faktörlü kimlik doğrulamayı kurmak için bu QR kodunu kimlik doğrulama uygulamanızla tarayın.                                                                              |
| `invite.qrAlt`                             | Two-factor QR code                                                                                                   | İki faktörlü kimlik doğrulama QR kodu                                                                                                                                         |
| `invite.manualEntry`                       | Manual entry:                                                                                                        | Elle girilecek kod:                                                                                                                                                           |
| `invite.saveNow`                           | Save this before you leave the page — it is not shown again.                                                         | Sayfadan ayrılmadan önce kodu kaydedin; bir daha gösterilmeyecek.                                                                                                             |
| `invite.askAdminTotp`                      | Ask your administrator to set up two-factor authentication.                                                          | İki faktörlü kimlik doğrulamanın kurulması için yöneticinize başvurun.                                                                                                        |
| `invite.accessPending`                     | Your access is still being set up — if signing in shows nothing yet, try again in a minute.                          | Erişiminiz hâlâ hazırlanıyor. Giriş yaptığınızda henüz bir şey görmüyorsanız bir dakika sonra yeniden deneyin.                                                                |
| `invite.goToSignIn`                        | Go to sign-in                                                                                                        | Giriş sayfasına git                                                                                                                                                           |
| `invitations.title`                        | Invite People                                                                                                        | Kişi davet edin                                                                                                                                                               |
| `invitations.loading`                      | Loading…                                                                                                             | Yükleniyor…                                                                                                                                                                   |
| `invitations.notFoundTitle`                | Not Found                                                                                                            | Bulunamadı                                                                                                                                                                    |
| `invitations.notFound`                     | There is no invitations page here.                                                                                   | Burada bir davet sayfası yok.                                                                                                                                                 |
| `invitations.signInTitle`                  | Sign In to Continue                                                                                                  | Devam etmek için giriş yapın                                                                                                                                                  |
| `invitations.signInText`                   | Sign in to invite people.                                                                                            | Kişi davet etmek için giriş yapın.                                                                                                                                            |
| `invitations.signIn`                       | Sign in                                                                                                              | Giriş yap                                                                                                                                                                     |
| `invitations.signInLoop`                   | If signing in brings you back here again and again, clear this site’s cookies in your browser and sign in once more. | Giriş yaptıktan sonra tekrar tekrar bu sayfaya dönüyorsanız tarayıcınızda bu sitenin çerezlerini temizleyip yeniden giriş yapın.                                              |
| `invitations.unavailableTitle`             | Not Available                                                                                                        | Kullanılamıyor                                                                                                                                                                |
| `invitations.unavailable`                  | You cannot invite people into this application, or invitations are turned off for it.                                | Bu uygulamaya kişi davet etme yetkiniz yok ya da uygulamada davetler kapalı.                                                                                                  |
| `invitations.errorTitle`                   | Something Went Wrong                                                                                                 | Bir sorun oluştu                                                                                                                                                              |
| `invitations.unreachable`                  | The relay could not be reached.                                                                                      | Sunucuya ulaşılamadı.                                                                                                                                                         |
| `invitations.to`                           | to {plugin}                                                                                                          | Uygulama: {plugin}                                                                                                                                                            |
| `invitations.noRole`                       | You may not invite anyone with your role.                                                                            | Rolünüz kimseyi davet etmenize izin vermiyor.                                                                                                                                 |
| `invitations.email`                        | E-mail address                                                                                                       | E-posta adresi                                                                                                                                                                |
| `invitations.emailDomains`                 | Under {domains}                                                                                                      | İzin verilen alan adları: {domains}                                                                                                                                           |
| `invitations.theirName`                    | Their name (optional)                                                                                                | Kişinin adı soyadı (isteğe bağlı)                                                                                                                                             |
| `invitations.role`                         | Role                                                                                                                 | Rol                                                                                                                                                                           |
| `invitations.bounds_one` / `_other`        | A link works once and expires after {days} day / days. You have {open} of {max} open invitations.                    | Her bağlantı yalnızca bir kez kullanılabilir ve {days} gün sonra süresi dolar. Açık davetleriniz: {open}/{max}. (one = other)                                                 |
| `invitations.create`                       | Create Invitation                                                                                                    | Davet oluştur                                                                                                                                                                 |
| `invitations.ready`                        | The invitation is ready. Send this link yourself — it is shown only now, and whoever opens it first can accept it.   | Davet hazır. Bu bağlantıyı kişiye kendiniz gönderin: yalnızca şimdi gösteriliyor ve bağlantıyı ilk açan kişi daveti kabul edebilir.                                           |
| `invitations.copy` / `copied` / `selected` | Copy / Copied / Selected                                                                                             | Kopyala / Kopyalandı / Seçildi                                                                                                                                                |
| `invitations.yours`                        | Your invitations                                                                                                     | Davetleriniz                                                                                                                                                                  |
| `invitations.none`                         | None yet.                                                                                                            | Henüz davet yok.                                                                                                                                                              |
| `invitations.back`                         | ← Back to {plugin}                                                                                                   | ← {plugin} uygulamasına dön                                                                                                                                                   |
| `invitations.revoke`                       | Revoke                                                                                                               | İptal et                                                                                                                                                                      |
| `invitations.reallyRevoke`                 | Really revoke?                                                                                                       | Davet iptal edilsin mi?                                                                                                                                                       |
| `status.pending` … `revoked`               | Pending · Expired · Being accepted · Accepted · Revoked                                                              | Bekliyor · Süresi doldu · Kabul ediliyor · Kabul edildi · İptal edildi                                                                                                        |
| `unavailable.title`                        | Not Available Right Now                                                                                              | Şu anda kullanılamıyor                                                                                                                                                        |
| `unavailable.text`                         | This application is not available right now. Try again later.                                                        | Bu uygulama şu anda kullanılamıyor. Lütfen daha sonra yeniden deneyin.                                                                                                        |
| `forbidden.title`                          | Not Allowed                                                                                                          | İzin verilmiyor                                                                                                                                                               |
| `forbidden.text`                           | You cannot open this page.                                                                                           | Bu sayfayı açma izniniz yok.                                                                                                                                                  |

#### 8.2 Refusals the pages map (§6)

| Code (status)                                                                | English                                                                                      | Türkçe (reviewed)                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `invitation_not_found` (404)                                                 | This invitation link is not valid.                                                           | Bu davet bağlantısı geçerli değil.                                                                          |
| `invitation_used` (410)                                                      | This invitation has already been used.                                                       | Bu davet daha önce kullanılmış.                                                                             |
| `invitation_expired` (410)                                                   | This invitation has expired.                                                                 | Bu davetin süresi dolmuş.                                                                                   |
| `invitation_closed` (410)                                                    | This invitation is no longer valid.                                                          | Bu davet artık geçerli değil.                                                                               |
| `invitation_revoked` (410)                                                   | This invitation was revoked while it was being accepted.                                     | Bu davet, kabul edilirken iptal edildi.                                                                     |
| `invitation_accepting` (409)                                                 | This invitation is being accepted right now.                                                 | Bu davet şu anda kabul ediliyor.                                                                            |
| `invitation_unavailable` (503)                                               | This invitation cannot be accepted right now — try again later.                              | Bu davet şu anda kabul edilemiyor. Lütfen daha sonra yeniden deneyin.                                       |
| `username_unavailable` (409)                                                 | This username is not available — choose another.                                             | Bu kullanıcı adı kullanılamıyor. Başka bir kullanıcı adı deneyin.                                           |
| `invalid_request` + `field` username / password / displayName / email / role | Invalid username / password / name / e-mail address / role.                                  | Kullanıcı adı geçersiz. / Şifre geçersiz. / Ad soyad geçersiz. / E-posta adresi geçersiz. / Rol geçersiz.   |
| `invalid_request` (no field)                                                 | Something you entered is not valid.                                                          | Girdiğiniz bilgilerden biri geçersiz.                                                                       |
| `invitations_unavailable` (403)                                              | Invitations are not available for this application.                                          | Bu uygulamada davetler kullanılamıyor.                                                                      |
| `email_domain_not_allowed` (400)                                             | Invitations cannot go to this e-mail address’s domain.                                       | Bu alan adındaki e-posta adreslerine davet oluşturulamaz.                                                   |
| `role_not_grantable` (403)                                                   | You may not invite people with this role.                                                    | Bu rolle kişi davet edemezsiniz.                                                                            |
| `invitation_rate` (429)                                                      | Too many invitations in the last hour — try again later.                                     | Son bir saatte çok fazla davet oluşturdunuz. Lütfen daha sonra yeniden deneyin.                             |
| `invitation_cap` `inviter` (409)                                             | You have reached your limit of open invitations — revoke one or wait for one to be accepted. | Açık davet sınırınıza ulaştınız. Bir daveti iptal edin ya da davetlerden birinin kabul edilmesini bekleyin. |
| `invitation_cap` `plugin` (409)                                              | This application takes no more people by invitation.                                         | Bu uygulamaya davetle daha fazla kişi eklenemiyor.                                                          |
| `grant_reserve` (503)                                                        | No more people can be added by invitation right now.                                         | Şu anda davetle yeni kişi eklenemiyor.                                                                      |
| `gatekeeper_unavailable`, `authelia_storage_unavailable` (503)               | The service is not answering — try again shortly.                                            | Hizmet şu anda yanıt vermiyor. Lütfen biraz sonra yeniden deneyin.                                          |
| `not_found` (404, the inviter's revoke)                                      | Invitation not found.                                                                        | Davet bulunamadı.                                                                                           |
| by status 429                                                                | Too many requests — wait a moment and try again.                                             | Çok fazla istek gönderildi. Lütfen biraz bekleyip yeniden deneyin.                                          |
| by status 5xx / other                                                        | Something went wrong — try again later.                                                      | Bir sorun oluştu. Lütfen daha sonra yeniden deneyin.                                                        |
| inviter's form, no address                                                   | Enter an e-mail address.                                                                     | Bir e-posta adresi girin.                                                                                   |
| inviter's form, not an address                                               | Enter a valid e-mail address.                                                                | Geçerli bir e-posta adresi girin.                                                                           |

#### 8.3 Gatekeeper's pages (P6, P7)

| Key                               | English                                                                                                                   | Türkçe (reviewed)                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `access.title` / `access.heading` | Access Required                                                                                                           | Erişim gerekli                                                                                                                                   |
| `access.noAccess`                 | You don't have access to {host}                                                                                           | {host} adresine erişiminiz yok                                                                                                                   |
| `access.signedInAs`               | Signed in as {username}                                                                                                   | Giriş yapılan hesap: {username}                                                                                                                  |
| `access.contact`                  | Contact {admin} to request access. Copy a message template below:                                                         | Erişim istemek için {admin} ile iletişime geçin. Aşağıdaki mesaj şablonlarından birini kopyalayabilirsiniz:                                      |
| `access.defaultAdmin`             | your administrator                                                                                                        | yöneticiniz                                                                                                                                      |
| `access.defaultAdminSalutation`   | Administrator                                                                                                             | Yönetici (unused in Turkish: the e-mail body has no name, below)                                                                                 |
| `access.subjectLabel`             | Subject:                                                                                                                  | Konu:                                                                                                                                            |
| `access.labelEmail`               | Email                                                                                                                     | E-posta                                                                                                                                          |
| `access.copy` / `copied`          | Copy / Copied                                                                                                             | Kopyala / Kopyalandı                                                                                                                             |
| `contact.admin` / `contact.help`  | Admin: / Help:                                                                                                            | Yönetici: / Yardım:                                                                                                                              |
| `template.subject`                | Access request for {resource}                                                                                             | {resource} için erişim talebi                                                                                                                    |
| `template.body`                   | Hi {admin},⏎⏎I'd like to request access to {resource}.⏎My username is: {username}⏎⏎Thank you.                             | Merhaba,⏎⏎{resource} adresine erişim talep ediyorum.⏎Kullanıcı adım: {username}⏎⏎Teşekkürler.                                                    |
| `template.chat`                   | Hi, could I get access to {resource}? My username is {username}.                                                          | Merhaba, {resource} adresine erişim izni verebilir misiniz? Kullanıcı adım: {username}.                                                          |
| `template.whatsapp`               | Hi, I need access to {resource} (username: {username}). Thanks!                                                           | Merhaba, {resource} adresine erişmem gerekiyor (kullanıcı adım: {username}). Teşekkürler!                                                        |
| `template.generic`                | Access request for {resource}⏎Username: {username}⏎Admin contact: {contact}                                               | {resource} için erişim talebi⏎Kullanıcı adı: {username}⏎Yönetici iletişim bilgisi: {contact}                                                     |
| `refusal.title`                   | Not allowed — {domain}                                                                                                    | İzin verilmiyor — {domain}                                                                                                                       |
| `refusal.notAllowedOn`            | Not allowed on {host}                                                                                                     | {host} adresine erişim izniniz yok                                                                                                               |
| `refusal.notMember`               | Not a member of {domain}                                                                                                  | {domain} üyeleri arasında değilsiniz                                                                                                             |
| `refusal.noDomain`                | Your account is signed in, but this host is under none of this relay's domains, so nobody may open it.                    | Giriş yaptınız, ancak bu adres sunucunun hiçbir alan adına bağlı olmadığından kimse tarafından açılamaz.                                         |
| `refusal.site`                    | Your account is signed in, but it may not open this site: it is not a member of {domain}, or not one of the site's users. | Giriş yaptınız, ancak bu siteyi açma izniniz yok: {domain} üyeleri arasında değilsiniz ya da bu sitenin kullanıcıları arasında yer almıyorsunuz. |
| `refusal.domain`                  | Your account is signed in, but it is not a member of this domain, so none of its applications are open to it.             | Giriş yaptınız, ancak bu alan adının üyesi olmadığınız için buradaki uygulamaların hiçbirine erişemezsiniz.                                      |
| `refusal.ask`                     | Ask {admin} to add you if you should have access.                                                                         | Erişiminiz olması gerekiyorsa {admin} ile iletişime geçip sizi eklemesini isteyin.                                                               |
| `refusal.signOut`                 | [Sign out] to sign in with another account.                                                                               | Başka bir hesapla giriş yapmak için [oturumu kapatın].                                                                                           |

The e-mail body drops the salutation's name in Turkish ("Merhaba,"): a
default administrator name reads oddly after "Merhaba" and an operator-set
name is not always a person's.

#### 8.4 Authelia supplement and corrections (P3–P5)

Keys missing in Authelia 4.39.28's `tr-TR` (the values Lamaste supplies):

| Namespace | English (key)                                                                                                                                                                    | Türkçe (reviewed)                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| portal    | Enter your password to confirm your identity                                                                                                                                     | Kimliğinizi doğrulamak için şifrenizi girin                                                                                                                   |
| portal    | Failed to confirm your identity                                                                                                                                                  | Kimliğiniz doğrulanamadı                                                                                                                                      |
| portal    | Failed to redirect you                                                                                                                                                           | Yönlendirme yapılamadı                                                                                                                                        |
| portal    | Home                                                                                                                                                                             | Ana sayfa                                                                                                                                                     |
| portal    | Language                                                                                                                                                                         | Dil                                                                                                                                                           |
| portal    | Loading                                                                                                                                                                          | Yükleniyor                                                                                                                                                    |
| portal    | Logout and clear any current flow                                                                                                                                                | Oturumu kapat ve mevcut işlemi iptal et                                                                                                                       |
| portal    | Logout and continue the current flow                                                                                                                                             | Oturumu kapat ve mevcut işleme devam et                                                                                                                       |
| portal    | Settings                                                                                                                                                                         | Ayarlar                                                                                                                                                       |
| portal    | Sign in with a passkey                                                                                                                                                           | Geçiş anahtarıyla giriş yap                                                                                                                                   |
| portal    | Switch User                                                                                                                                                                      | Kullanıcı Değiştir                                                                                                                                            |
| portal    | Toggle password visibility                                                                                                                                                       | Şifreyi göster veya gizle                                                                                                                                     |
| portal    | Warning                                                                                                                                                                          | Uyarı                                                                                                                                                         |
| portal    | You have made too many requests                                                                                                                                                  | Çok fazla istekte bulundunuz                                                                                                                                  |
| portal    | You must view and accept the Privacy Policy before using {{authelia}}. (value: `<policy>Privacy Policy</policy>`)                                                                | {{authelia}} hizmetini kullanmadan önce <policy>gizlilik politikasını</policy> görüntüleyip kabul etmeniz gerekir                                             |
| portal    | or                                                                                                                                                                               | veya                                                                                                                                                          |
| settings  | Caps Lock is on                                                                                                                                                                  | Caps Lock açık                                                                                                                                                |
| settings  | Change Password                                                                                                                                                                  | Şifreyi Değiştir                                                                                                                                              |
| settings  | Cross-Platform                                                                                                                                                                   | Platformlar Arası                                                                                                                                             |
| settings  | Delete                                                                                                                                                                           | Sil                                                                                                                                                           |
| settings  | Email One-Time Code                                                                                                                                                              | E-posta ile Tek Seferlik Kod                                                                                                                                  |
| settings  | Email                                                                                                                                                                            | E-posta                                                                                                                                                       |
| settings  | Edit                                                                                                                                                                             | Düzenle                                                                                                                                                       |
| settings  | Edit WebAuthn Credential                                                                                                                                                         | WebAuthn Kimlik Bilgisini Düzenle                                                                                                                             |
| settings  | Failed to get session elevation status                                                                                                                                           | Oturum yükseltme durumu alınamadı                                                                                                                             |
| settings  | Incorrect password                                                                                                                                                               | Yanlış şifre                                                                                                                                                  |
| settings  | In order to perform this action, policy enforcement requires that two-factor authentication is performed                                                                         | Bu işlemi yapabilmek için iki faktörlü kimlik doğrulama yapmanız gerekiyor                                                                                    |
| settings  | Information                                                                                                                                                                      | Bilgi                                                                                                                                                         |
| settings  | New Password / Old Password / Password / Repeat New Password                                                                                                                     | Yeni Şifre / Eski Şifre / Şifre / Yeni Şifre (Tekrar)                                                                                                         |
| settings  | Passwords do not match                                                                                                                                                           | Şifreler eşleşmiyor                                                                                                                                           |
| settings  | Password changed successfully                                                                                                                                                    | Şifre başarıyla değiştirildi                                                                                                                                  |
| settings  | Platform                                                                                                                                                                         | Platform                                                                                                                                                      |
| settings  | Security                                                                                                                                                                         | Güvenlik                                                                                                                                                      |
| settings  | Select a Method                                                                                                                                                                  | Bir Yöntem Seçin                                                                                                                                              |
| settings  | Submit                                                                                                                                                                           | Gönder                                                                                                                                                        |
| settings  | The decision to disable WebAuthn Credentials when Multi-Factor Authentication is enabled significantly undermines security and is highly inadvisable                             | Çok faktörlü kimlik doğrulama etkinken WebAuthn kimlik bilgilerini devre dışı bırakmak güvenliği ciddi biçimde zayıflatır ve kesinlikle önerilmez             |
| settings  | There was an issue changing the password                                                                                                                                         | Şifre değiştirilirken bir sorun oluştu                                                                                                                        |
| settings  | There was an issue retrieving configuration                                                                                                                                      | Yapılandırma alınırken bir sorun oluştu                                                                                                                       |
| settings  | This is disabled by your administrator                                                                                                                                           | Bu özellik yöneticiniz tarafından devre dışı bırakılmış                                                                                                       |
| settings  | Toggle new / old / repeat new password visibility                                                                                                                                | Yeni şifreyi / Eski şifreyi / Yeni şifre tekrarını göster veya gizle                                                                                          |
| settings  | Username / Name / WebAuthn                                                                                                                                                       | Kullanıcı adı / Ad / WebAuthn                                                                                                                                 |
| settings  | WebAuthn Credentials are widely considered the most secure means of authentication, regardless of if they're used for Multi-Factor Authentication or Passwordless Authentication | WebAuthn kimlik bilgileri, ister çok faktörlü ister şifresiz kimlik doğrulama için kullanılsın, genel olarak en güvenli kimlik doğrulama yöntemi kabul edilir |
| settings  | You can only register a single One-Time Password                                                                                                                                 | Yalnızca bir Tek Seferlik Şifre kaydedebilirsiniz                                                                                                             |
| settings  | You cannot reuse your old password                                                                                                                                               | Eski şifrenizi yeniden kullanamazsınız                                                                                                                        |
| settings  | Your administrator has disabled WebAuthn preventing you from registering WebAuthn Credentials including Passkeys                                                                 | Yöneticiniz WebAuthn özelliğini devre dışı bıraktığı için geçiş anahtarları dâhil hiçbir WebAuthn kimlik bilgisi kaydedemezsiniz                              |
| settings  | Your supplied password does not meet the password policy requirements                                                                                                            | Girdiğiniz şifre, şifre politikasının gereksinimlerini karşılamıyor                                                                                           |
| consent   | Accept this consent request / Deny this consent request                                                                                                                          | Bu onay isteğini kabul et / Bu onay isteğini reddet                                                                                                           |
| consent   | An error occurred processing the request                                                                                                                                         | İstek işlenirken bir hata oluştu                                                                                                                              |
| consent   | Code / Confirm the Code / Enter the code displayed on your device / Failed to submit the user code                                                                               | Kod / Kodu Onaylayın / Cihazınızda görüntülenen kodu girin / Kullanıcı kodu gönderilemedi                                                                     |
| consent   | Consent has been accepted and processed / …rejected and processed                                                                                                                | Onay kabul edildi ve işlendi / Onay reddedildi ve işlendi                                                                                                     |
| consent   | Debug Information / Description / Documentation / Error / Error Code / Hint / Required                                                                                           | Hata Ayıklama Bilgisi / Açıklama / Belgeler / Hata / Hata Kodu / İpucu / Zorunlu                                                                              |
| consent   | Hide request details / Show request details / Return to the consent request                                                                                                      | İstek ayrıntılarını gizle / İstek ayrıntılarını göster / Onay isteğine dön                                                                                    |
| consent   | Information Shared / Requested Permissions / Requested Resources / Token Audience                                                                                                | Paylaşılan Bilgiler / İstenen İzinler / İstenen Kaynaklar / Belirteç Alıcıları                                                                                |
| consent   | The actions the application will be allowed to perform on your behalf                                                                                                            | Uygulamanın sizin adınıza yapmasına izin verilecek işlemler                                                                                                   |
| consent   | The information about you the application will receive                                                                                                                           | Uygulamanın sizinle ilgili alacağı bilgiler                                                                                                                   |
| consent   | The protected resources the application intends to access                                                                                                                        | Uygulamanın erişmek istediği korumalı kaynaklar                                                                                                               |
| consent   | The services the issued tokens will be valid for                                                                                                                                 | Verilen belirteçlerin geçerli olacağı hizmetler                                                                                                               |
| consent   | You may close this tab or return home by clicking the home button                                                                                                                | Bu sekmeyi kapatabilir ya da ana sayfa düğmesiyle ana sayfaya dönebilirsiniz                                                                                  |
| consent   | You must reauthenticate to be able to give consent                                                                                                                               | Onay verebilmek için yeniden kimlik doğrulaması yapmanız gerekiyor                                                                                            |
| consent   | You will be asked to review the request next                                                                                                                                     | Ardından isteği incelemeniz istenecek                                                                                                                         |
| consent   | scopes.authelia.pam ("Authenticate to a Linux system as you")                                                                                                                    | Bir Linux sistemine sizin kimliğinizle giriş yapma                                                                                                            |

Corrections Lamaste applies over Authelia's `tr-TR` (D5 — the reviewer may
add to this list; each one is also offered to Authelia's translators):

| Key                                           | Authelia 4.39.28 `tr-TR`                  | Lamaste                                      |
| --------------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| Powered by {{authelia}}                       | Tarafından desteklenmektedir {{authelia}} | Altyapı: {{authelia}}                        |
| Must be at least {{len}} characters in length | {{len}} karakter uzunluğunda olmalıdır    | En az {{len}} karakter uzunluğunda olmalıdır |
| Failed to revoke the One-Time Code            | Tek Seferlik Kodu iptal edemedim          | Tek Seferlik Kod iptal edilemedi             |

The `<noscript>` rewrite (§3): "Bu uygulama için tarayıcınızda JavaScript etkin olmalıdır." (written into the vhost as ASCII character references).

#### 8.5 Glossary

| English                                         | Türkçe                                                 |
| ----------------------------------------------- | ------------------------------------------------------ |
| sign in / sign-in page / signed in              | giriş yap / giriş sayfası / giriş yaptınız             |
| sign out                                        | oturumu kapat (Authelia's "Sign out" and "Logout")     |
| username / password                             | kullanıcı adı / şifre                                  |
| two-factor / multi-factor authentication        | iki faktörlü / çok faktörlü kimlik doğrulama           |
| authenticator app                               | kimlik doğrulama uygulaması                            |
| one-time password (TOTP) / one-time code (mail) | Tek Seferlik Şifre / Tek Seferlik Kod                  |
| passkey                                         | geçiş anahtarı                                         |
| link                                            | bağlantı                                               |
| expire / expires (label)                        | süresi dol- / son geçerlilik tarihi                    |
| revoke / cancel (dismiss)                       | iptal et / vazgeç (never "İptal" for a dismiss button) |
| administrator                                   | yönetici (yöneticiniz)                                 |
| access / permission                             | erişim / izin                                          |
| access request (to an admin) / request (HTTP)   | erişim talebi / istek                                  |
| site / host address                             | site / adres                                           |
| account / domain                                | hesap / alan adı                                       |
| application (a plugin)                          | uygulama                                               |
| relay                                           | sunucu                                                 |
| invitation / open invitation / invite (verb)    | davet / açık davet / davet et, davet oluştur           |
| people / member                                 | kişiler / üye (a domain's members: "{domain} üyeleri") |

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
- `formatMessage(text, values)` for `{name}` placeholders, one pass (§4;
  server side; the page script has the same short function), `pluralKey(lang, n)`
  through `Intl.PluralRules`, and `htmlAsciiReferences(text)` for the one
  catalogue text that goes into a vhost (§3).
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
  namespaces, `#language-button`, `<html lang="`, the `<noscript>` text);
  `formatMessage` leaves a value holding `{plugin}` as text; `authPageShell`
  escapes a title and loading text holding `<`, `&`, `"`; the two page
  scripts never display `.error` (a source check, §4); the P8 page's style is
  identical for every brand and language.
- Regression pins (wave 2/3): an **unset domain's auth vhost differs from
  4.9.0's only in the CSP hashes** (a fixture of the 4.9.0 rendering); a
  served web-surface vhost is byte-identical to 4.9.0's; **Gatekeeper's
  English pages differ from 4.9.0's only in the copy button's markup** (`data-`
  label, the copy script).

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
  admits one path segment and three namespaces, and nothing else Authelia
  serves under `/locales/` has that shape.
- Everything written into a vhost is ASCII; the one Turkish text there (the
  `<noscript>` sentence) is HTML character references (§3).
- `title`, `loading` and every catalogue text are escaped where they enter
  markup (§4); formatting is one pass, so a name cannot inject a placeholder.
- The P8 page carries no script; its CSP admits only its own style by hash and
  the auth host's logo.
- The standalone Gatekeeper `GET /access-request` (a page built from a
  `Remote-User` header any local process can send) is removed.
- `sub_filter` values are literals without `$`; `lamaste-priv` keeps refusing
  `$` in them.
- Gatekeeper's language read cannot weaken membership: it never invalidates
  the projection.

## Upgrade in place

- Migration `0021`: every domain unset → no visible change.
- At the first start: the stock pages are rewritten (their markup now holds
  the data block — English text unchanged), every rendering re-renders once
  (`pagesDigest`), every auth vhost is compared by the start's vhost reconcile
  (the CSP hashes change with the script) and rewritten; not-served
  web-surface vhosts gain the error page and the stock
  `/var/www/lamaste/unavailable/index.html` is written (rewritten by
  `reconcileWebSurfaces`); `rendered.json` gains `autheliaVersion`, and a
  relay running an Authelia newer than the pin is audited and its admins
  notified once (§"What Authelia can do").
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
  plugin's site with its surface withdrawn answers P8 in Turkish on A (503,
  `lang="tr"`, the CSP, `no-store`) and in English on C; a shell request
  Gatekeeper refuses as not served answers P9 (403, the page, not an empty
  body) in Turkish on A; a revoked invitation's lookup answers
  `invitation_closed` (the code, the page is static); changing A to unset
  re-renders (Authelia's own files again), no Authelia restart in its journal,
  and the audit has both changes.
- **Single-VM, new spec 39 `page-language-validation`**: the API's refusals
  (`invalid_language`, unknown domain), `null` clears, the CLI, the vhost
  through `lamaste-priv`, the reconcile after a restart and after a tampered
  `rendered.json`, every new error code on `/api/invite/*` and
  `/api/delegated-invitations/*`.
- **Upgrade suite `01`**: after the Panel Update from 4.9.0, an unset domain's
  pages are English with the new CSP hashes, a 4.9 branded domain re-rendered
  once, a pending 4.9 invitation still opens.
- Not proven by rodeo (curl runs no script): the page scripts' rendering of
  the data block — the wave-5 browser pass covers it against a local preview
  of both pages in both languages, as 4.9's did against mocks — and the
  portal's own language choice, which wave 2's spike covers against a real
  Authelia 4.39.28 (§3).

## Waves

One agent per wave; each wave builds, lints, formats and tests before it
reports; the coordinator verifies and asks before the next.

0. **This document**, its independent review, and an independent reading of
   the Turkish (§8) by a reviewer who sees only the tables and the
   principles. Done; fixes folded in (_Review findings_).
1. **Core**: `page-messages.ts` + subpath, the catalogue (EN, TR), the pages
   rendering with a language and the data block, `authPagesDigest` over every
   language, the Authelia supplement/corrections and `renderForcedAutheliaLocale`,
   `renderAuthBranding` with `brand | null` and `language`, the projection's
   `language`, full Authelia fixtures, unit tests (incl. the hash invariant).
2. **serverd + nginx**: migration `0021`, the language route, audit, the
   running Authelia version (§"What Authelia can do"), rendering triggers and
   reconcile (brand _or_ language, §5), every auth-vhost writer passing the
   language, the auth vhost (forced locales, `lang`/`noscript` rewrite,
   stylesheet), the P8 error page and its stock copy, the projection writer;
   `lamaste-priv` allow-list and tests; the 4.9.0 regression pins; **the
   Authelia browser spike** (§3), whose result is recorded here before wave 3.
3. **Gatekeeper + API codes**: templates with `language`, P9 in
   `refuse('not_served')`, the copy-button fix, the two administrator-name
   keys, removal of `GET /access-request`, the projection's `language`;
   the error codes on `/api/invite/*` and `/api/delegated-invitations/*` and
   the pages' mapping; the English-pages regression pin. Gatekeeper builds
   clean (`rm -rf dist` first: its `build` copies its migrations with
   `cp -R`, which nests on a second run).
4. **Panel, CLI, desktop, docs**: Domains page select and rendering state,
   AdminClient + both clients + Rust, CLI, API reference and concept docs,
   CHANGELOG, version **4.10.0** across the lockstep packages.
5. **Turkish review on the real pages + browser pass**: the reviewer reads the
   rendered pages (screenshots of P1, P2, P6, P7, P8, P9 in `tr`), the built-in
   browser runs both page scripts against a local preview in both languages;
   fixes.
6. **Rodeo**: specs 56, 39, upgrade 01 on fresh VMs, against the 4.10.0
   candidate on the dev Feria; logs committed.

Then the PR to `develop`, reviewed and merged by rebase as #1–#4. No tag, no
publish, no change on the live relay: those are the founders'.

## Decisions (agreed 2026-11-03)

| #   | Question                                                  | Recommendation                                                                                                                                                                                                                                                                                                                  | Alternatives                                                                                       |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| D1  | Where the language lives                                  | `domains.language` (migration 0021), a property of the domain                                                                                                                                                                                                                                                                   | a field of the brand record (a language would need a brand); one language for the relay            |
| D2  | Values and "unset"                                        | `en`, `tr`, or unset; unset = today's behaviour; set = every page on the domain, Authelia included                                                                                                                                                                                                                              | a non-null default `en` that forces English on every domain at upgrade                             |
| D3  | `Accept-Language`                                         | No part                                                                                                                                                                                                                                                                                                                         | domain default, negotiated among the catalogue's languages (Lamaste's pages only, or Authelia too) |
| D4  | Authelia                                                  | Forced per domain: regex location serving one rendered file per namespace, menu hidden, `lang` and `<noscript>` (ASCII references) rewritten; the running version recorded and a newer one flagged; proven by a browser spike. Known gaps: settings dates in the browser's language; no switch for a reader of another language | leave Authelia on the browser (mixed languages on one domain); override only `en`                  |
| D5  | Authelia's Turkish gaps                                   | Supplement all missing keys of the three namespaces + three corrections; pinned by fixtures; offered upstream                                                                                                                                                                                                                   | portal only; no corrections                                                                        |
| D6  | How static pages get their words                          | A JSON data block in the markup; one script, one CSP hash pair per release                                                                                                                                                                                                                                                      | a per-domain `messages.json` fetched by the script; a script per language (two hash pairs)         |
| D7  | API refusals                                              | Codes on the refusals of `/api/invite/*` and `/api/delegated-invitations/*`; `error` stays English; pages map codes and never display `error` (status text otherwise)                                                                                                                                                           | the panel localises `error` by the request's domain                                                |
| D8  | Gatekeeper's source of the language                       | The projection `domains.json`, optional field, read leniently                                                                                                                                                                                                                                                                   | the rendering's `brand.json` (would need one for unbranded domains)                                |
| D9  | The rendering                                             | One per domain with a brand or a language                                                                                                                                                                                                                                                                                       | shared per-language stock renderings for unbranded domains                                         |
| D10 | nginx's 503 and Gatekeeper's empty 403 on a plugin's site | P8: a static Lamaste page from the rendering (stock copy otherwise), inline style, served by `error_page 503`; P9: rendered by Gatekeeper in `refuse('not_served')`                                                                                                                                                             | leave nginx's pages (English, unbranded)                                                           |
| D11 | Access-request message templates                          | In the domain's language                                                                                                                                                                                                                                                                                                        | always English (the administrator's language)                                                      |
| D12 | Formats                                                   | `{name}` placeholders, `Intl.PluralRules`, dates in the page's language, `novalidate` + own messages, no suffix on an interpolated name                                                                                                                                                                                         | browser-locale dates (today)                                                                       |
| D13 | Branch, version, proof                                    | `feat/page-language` off `develop`, **4.10.0**, waves above, specs 56 + 39 + upgrade 01                                                                                                                                                                                                                                         | 4.9.1 (it is a feature, not a fix)                                                                 |

## Review findings (2026-11-03)

Two independent reviews of the first draft, folded in above.

**Design, against the code and Authelia v4.39.28** — blocking: B1 `lamaste-priv`
refuses non-ASCII in any token, so the Turkish `<noscript>` text is written as
character references (§3); B2 it refuses a backslash, so the regex uses
`[.]json$` and, widened to `[^/]{1,64}`, catches every locale path (§3).
Should fix: S1 the running Authelia may be newer than the pin — recorded,
flagged, degradation documented; S2 a real-browser spike before rodeo (wave
2); S3 settings dates follow the browser (known gap, D4); S4 P9 is a blank
page today and is rendered by Gatekeeper, P8 inlines its style and is served
by `error_page 503`; S5 refusals outside `httpError` — the pages never display
`error`; S6 `Subject:` and the "Administrator" salutation became keys, the
JSON templates stay English, Revoke confirms by a flag; S7 escaping of the
shell's title and loading text, one-pass formatting; S8 4.9.0 regression pins,
wave 2 split in two. Minor: M1 reconcile and `renderedCurrent` take "brand or
language"; M2 every auth-vhost writer passes the language; M3 lock order, no
Authelia restart; M4 `GET /access-request` removed (unused, unbranded,
trusts `Remote-User`); M5 no switch for another reader (trade-off, D4). The
reviewer agreed with D1–D3, D5–D9, D11–D13, with D4 given S1–S3, and with D10's
goal but not its P9 mechanism (now changed).

**Turkish copy** — must-fix, applied: the username hint and rule name the
refused letters (ç, ğ, ı, ö, ş, ü) instead of "a–z arası"; "Elle giriş" (reads
as sign-in) → "Elle girilecek kod"; sentence case for headings and buttons,
short imperative for buttons; "şu anda" dropped where invitations may be off
for good; the WebAuthn sentence made grammatical (_ister … ister_); "devam
eden işleme devam et" → "mevcut işleme devam et". Should-fix, applied: one
term for the name field (_ad soyad_), _son geçerlilik tarihi_, _süresi dolar_,
"davet oluşturulamaz" (Lamaste sends no mail), the domain refusals as
"{domain} üyeleri arasında değilsiniz", "erişim izni verebilir misiniz",
"WebAuthn özelliğini", _dâhil_, the PAM scope as a noun phrase, "Altyapı:
{{authelia}}" for "Powered by". Optional items applied where they read better
(the revoke question, the no-role sentence, `refusal.ask`, lower-case
_gizlilik politikasını_, "Belirteç Alıcıları", the policy-enforcement
sentence, "kodu kaydedin"). The sign-in and sign-out terms follow Authelia's
own `tr-TR` (§8).
