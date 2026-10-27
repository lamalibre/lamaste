# Per-Domain Branding of the Auth Pages — Design Document

> **Status:** agreed 2026-10-27 (decisions D1–D8 as recommended); implementation on `feat/auth-branding`, waves below. Waves 1 to 5 done; the wave 5 specs ran on rodeo on 2026-10-27 (three-VM 52: 140 of 140, single-VM 37: 95 of 95, upgrade 01 from the npmjs 4.7.0 release: 55 of 55) after two fixes they found: Authelia lists the `srp` locale but serves none of its files (a listed file answered 404 is left out of the rendering), and the start's base check and the first tick's reconcile overlapped into two `branding-base` restarts on an upgraded relay (the check is single-flight). Wave 5 as built: three-VM spec 52, single-VM spec 37 and the upgrade suite's `01-panel-update` (`packages/tools/lamaste-rodeo/tests/`). Where the design left the assertion open, the specs assert the implementation: an unbranded domain's `/locales/<lang>/portal.json` is Authelia's own file (the title value still carries `{{authelia}}`), its `/static/media/logo.png` is the placeholder of `/etc/authelia/assets/logo.png` (asserted by digest, not only "another image") and its `/favicon.ico` Authelia's embedded one; a favicon's content type is whatever the relay's `/etc/nginx/mime.types` gives `.ico` (read in the spec, a PNG favicon served under the `.ico` name gets it too); the hidden footer is asserted as the rule in `brand.css` and the spliced "Powered by <name>" text (a curl cannot see the rendered page); Gatekeeper's pages are recognised by their titles (`Not allowed — <domain> — <name>`, `Access Required — <fqdn> — <name>`, the stock ones without the suffix) and their `--accent` (the pages' own `#22d3ee` on a stock page); the single-VM 413 is a PNG 100 bytes over the limit, so it stays under the route's body limit and `asset_too_large` is the panel's own answer; "one restart" is asserted as none after two panel restarts and at most one in the whole audit. The three-VM spec signs one member of A in at three sign-in pages rather than making three users. The harness gained `host_api_call_file` (a JSON body read from a file on the host VM — a base64 asset is too long for a command line). Wave 4 as built: the brand rules reach the panel UI through a new browser-safe subpath, `@lamalibre/lamaste/branding` (the root entry carries the Fastify plugin host and node's file helpers, which a Vite build cannot take — as `./domains` exists for the domain rules), never a copy; the CLI is `domains branding <d>` with subcommands (`set` with `--name … --clear … --if-revision`, `logo <file>`, `favicon <file>`, `remove`, `preview`) rather than one command with every flag, because a `set` merges over the brand read with `ifRevision` and a file is checked against its limit before the request — one command would have had to decide an order for both; the preview's logo is loaded from `https://auth.<domain>/static/media/logo.png?r=<revision>` only when the page would show it (domain active, rendering current, a logo set), and since the panel vhost sets no Content-Security-Policy nothing had to change there, while the desktop webview's CSP (`tauri.conf.json`) gained `https:` in `img-src` — an image cannot run code, and the hosts are the relay's own; both admin clients, the CLI's `parsePanelResponse` and the desktop's Rust refusal now keep a brand refusal's `errors` **list** and a refused image's `reason` (they kept only the settings map before, so the desktop dropped the field errors its own command's comment promised); the toast gained a warning variant for a change's `warnings`; the logo and favicon are plain file inputs (`accept` set), not drop targets — a file input is what the operator's browser and the desktop webview both handle without a library. Wave 3 as built: the invitation page's HTML moved into core (`server/invite-page.ts`, `renderInvitePage(brand | null)`; serverd writes the stock page at provisioning **and at every start**, compared first, so a change to the page reaches existing relays), the auth vhost serves it with `root <rendering>; try_files /invite/index.html @invite` and a named fallback to the stock page rather than an alias pointed per domain (one vhost shape for branded and unbranded domains; the switch is the rendering's presence); `brand.json` is read back with a zod schema of exactly its shape (`BrandJsonSchema`, custom checks for `v` and `theme` so no issue echoes a value) and must name the domain it was read for; Gatekeeper caches each domain's answer for 5 s and logs transitions only; the pages' logo URL is built from the projection's domain, never taken from the file; the access-request message templates' contact line names the brand's support e-mail when set (the `adminName` salutation is unchanged); Gatekeeper's pages keep their dark look whatever the brand's theme (the theme is the sign-in's and the invitation page's). Wave 2 as built differs in three details: `lamaste-priv` also refuses a `$` in either `sub_filter` argument (nginx expands variables in both; the generator writes literals only); a brand change that nginx refuses is kept on a pending set retried every minute (the start's vhost reconcile compares every auth vhost, so a restart loses nothing — no per-tick compare of every vhost); and a brand may be set on a pending domain, whose activation writes the vhost branded. `renderAuthVhost` takes `branding: { theme, logo } | null`, not a `branded` flag.
> **Target:** Lamaste 4.8.0, on top of 4.7.0 (multi-domain relay, external members).
> **Pilot:** `codelama.com.tr` and `samplepark.tr` on the relay `138.68.65.228`, each with its own name, logo, favicon, colours and sign-in text.
> **Companions:** `multi-domain-relay-design.md` (one sign-in host per domain), `external-members-design.md`, `gatekeeper-design.md`.

## Goal

A visitor of `samplepark.tr` signs in on a page that says samplepark; a
visitor of `codelama.com.tr` on one that says Code Lama. Today every domain's
`auth.<domain>` is Authelia's stock page (Authelia logo, "Powered by
Authelia", browser title "Login - Authelia"), the invitation page says
"Lamaste", and Gatekeeper's refusal pages carry the panel's dark terminal look
and no brand. The operator sets a domain's brand once, in the panel, and every
page a visitor of that domain can meet shows it:

| Page                                                          | Served by                                           | Today                                   |
| ------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------- |
| Sign-in, second factor, OIDC consent, account settings        | Authelia at `auth.<domain>`                         | Authelia stock, one look for every host |
| Invitation acceptance `auth.<domain>/invite/<token>`          | static file, `server/daemon/src/lib/invite-page.js` | "Lamaste — Accept Invitation", one file |
| Access-request page (restricted tunnel, 403)                  | Gatekeeper, inline on the tunnel host               | dark terminal, no brand                 |
| Domain refusal (signed in, not a member), static-site refusal | Gatekeeper, inline                                  | dark terminal, no brand                 |
| User-surface refusals                                         | panel / Gatekeeper, JSON                            | unchanged (not a page)                  |

Out of scope: the admin panel, agent panels and the certificate-help page
(mTLS admin surfaces), Authelia's e-mail templates (the relay sends none:
`notifier.filesystem`).

## What Authelia 4.39.28 allows (verified against the pinned release)

- **One `server.asset_path` per instance.** `AssetOverride` serves a file from
  it instead of the embedded one for exactly three routes: `/favicon.ico`,
  `/static/media/logo.png` and `/locales/<lang>[-<variant>]/<namespace>.json`
  (`internal/server/handlers.go`). It stats the file on every request (live,
  no restart) and never reads the `Host` header: **Authelia cannot brand per
  domain by itself**.
- **The logo is shown only when `asset_path/logo.png` exists when Authelia
  starts** (`NewTemplatedFileOptions` → `data-logooverride="true"` in the
  index HTML, `internal/server/template.go`); otherwise the UI renders its
  generic user icon and never requests the logo.
- **`theme`** is one value for the instance (`light` default, `dark`, `grey`,
  `oled`, `auto`), rendered as `data-theme="…"` on `<body>`. The themes are
  CSS custom properties on `[data-theme="…"]` (`web/src/themes/tailwind-themes.css`:
  `--background`, `--card`, `--primary`, `--ring`, `--custom-icon`, …).
- **Texts** come from `/locales/<lang>/portal.json` (i18next, namespace
  `portal`; `tr` falls back to `en`, `en` to the key itself). An override file
  replaces the whole file for that language. The brand-bearing keys are
  `"Login - {{authelia}}"` (the browser title) and `"Powered by {{authelia}}"`
  (the footer link to authelia.com, `web/src/components/Brand.tsx`); `{{authelia}}`
  is interpolated from a constant and is not configurable.
- **The index HTML** is a Go template with a per-request CSP nonce. Its
  default CSP is `default-src 'self'; … style-src 'self' 'nonce-…'; …`, so a
  same-origin stylesheet and same-origin images are allowed, inline styles are
  not. (`server.headers.csp_template` stays untouched.)
- Nothing else: no custom HTML, no per-host assets, no title option.

Everything per domain therefore happens in **nginx**, in the `auth.<domain>`
vhost Lamaste already writes per domain (`renderAuthVhost`, `server/daemon/src/lib/nginx.js`):
the three overridable routes are answered from a per-domain directory when
the domain has the file, else passed to Authelia; and the index HTML is
rewritten on its way through (`ngx_http_sub_module`, part of Ubuntu's nginx
build — checked by create-lamaste, D4).

## Model

### The brand record

`state.db` migration `0019_domain_branding.sql`:

```sql
CREATE TABLE domain_branding (
  domain          TEXT PRIMARY KEY REFERENCES domains(name) ON DELETE CASCADE,
  name            TEXT NOT NULL,            -- 'Code Lama' — the brand's name
  tagline         TEXT,                     -- optional, under the name on Lamaste's own pages
  theme           TEXT NOT NULL,            -- light | dark | grey | oled | auto
  accent          TEXT,                     -- '#rrggbb' — buttons, focus rings, links
  support_email   TEXT,                     -- shown on refusal pages (else Gatekeeper's adminEmail)
  support_url     TEXT,                     -- https:// only
  logo            BLOB,                     -- PNG ≤ 512 KiB, ≤ 1024×1024
  logo_sha256     TEXT,
  favicon         BLOB,                     -- ICO or PNG ≤ 64 KiB
  favicon_sha256  TEXT,
  revision        INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL
);
```

- The database is the source of truth; the files nginx serves are a
  **rendering** of it, rebuilt at every change and reconciled at start (as the
  web-surface tree store does). A relay restored from a backup of `state.db`
  renders its brands again by itself.
- Validation in core (`core/lib/src/auth-branding.ts`, browser-safe so the
  panel form shares it): `name` 1–64 printable characters, no control or bidi
  characters, no `<`/`>`/`{`/`}` (it is spliced into Authelia's translation
  strings, some of which carry `<policy>` tags and `{{…}}` interpolations);
  `tagline` ≤ 160; `accent` `^#[0-9a-f]{6}$`; `support_url` `https:` only;
  the logo is parsed (PNG signature, IHDR width/height, no SVG — a script
  carrier on the sign-in origin), the favicon too (ICO header or PNG). Nothing
  free-form: no CSS, no HTML, no SVG from the operator. The panel renders every
  byte a visitor receives from validated fields.
- One brand per domain; a removed domain's brand goes with it (cascade), its
  rendered directory is removed by the same operation.

### The rendering

`/var/www/lamaste/auth/<domain>/` (web root: `lamaste:www-data`, 2750/0640,
nginx reads via the group — as `/invite/` today):

```
favicon.ico                    when set
static/media/logo.png          when set
locales/<lang>/portal.json     every language Authelia lists, brand name spliced in
brand.css                      colours from `accent` (and the footer rule), see below
invite/index.html              the invitation page, branded
brand.json                     name, tagline, theme, accent, support — read by Gatekeeper
```

- **Locales**: the panel fetches Authelia's own list (`GET 127.0.0.1:9091/locales`)
  and each embedded `portal.json`, replaces `{{authelia}}` by the brand name
  in every value that carries it (so Turkish stays Turkish: "Giriş - Code
  Lama"), and writes the merged file. Every language is rendered, because an
  override file replaces the whole language: a partial `tr` would lose its
  translations. Re-rendered when the brand changes and when the Authelia
  version differs from the one recorded on the rendering (`rendered.json`:
  revision, Authelia version), so a pin bump re-renders at the next start.
- **`brand.css`** is generated, never authored: it redefines the theme's own
  custom properties on `[data-theme]` from `accent` (`--primary`, `--ring`,
  `--custom-icon`, `--custom-loading-bar`, and `--secondary` kept) and hides
  the "Powered by" footer (`a[href^="https://www.authelia.com"]`, D3). The
  selectors are the pinned release's theme contract; a unit test pins them
  against a fixture of 4.39.28's `tailwind-themes.css`, so a pin bump that
  renames one fails the build, not the visitor.
- Written as the web-tree store writes a plugin's shell: each rendering is
  a directory of its own, `/var/www/lamaste/auth/.renders/<domain>-<revision>-<hex>/`
  (every file fsynced, 0640; directories 0750), and `/var/www/lamaste/auth/<domain>`
  is a **symbolic link** to the one that serves. A change renders beside
  the old directory and replaces the link with one `rename` — nginx and
  Gatekeeper see the old rendering or the new one, never none and never a
  mix — then removes the old directory (renamed aside first, never deleted
  through the served path). A brand's removal removes the link, then its
  directory; the reconcile prunes `.renders/` entries nothing links to.
  nginx's `root` resolves the link on every open (`disable_symlinks` is
  `off` by default; the auth vhost must leave it so).

### The `auth.<domain>` vhost

`renderAuthVhost(domain, certPath, { primary, branded })` gains, for every
domain:

```nginx
    # Brand overrides: the domain's file when it has one, else Authelia's
    location = /favicon.ico            { root /var/www/lamaste/auth/<domain>; try_files $uri @authelia; }
    location = /static/media/logo.png  { root /var/www/lamaste/auth/<domain>; try_files $uri @authelia; }
    location /locales/                 { root /var/www/lamaste/auth/<domain>; try_files $uri @authelia; }
    location = /brand.css              { root /var/www/lamaste/auth/<domain>; try_files $uri =404; }
    location @authelia                 { proxy_pass http://127.0.0.1:9091; …the same headers as / }

    location / {
        proxy_pass http://127.0.0.1:9091;
        …
        # The index HTML, as Authelia renders it for every domain, made this
        # domain's: its theme, its stylesheet, its logo switch.
        proxy_set_header Accept-Encoding "";
        sub_filter_once off;
        sub_filter 'data-theme="light"'        'data-theme="<theme>"';
        sub_filter 'data-logooverride="true"'  'data-logooverride="<true|false>"';
        sub_filter '</head>'                   '<link rel="stylesheet" href="/brand.css"></head>';
    }
```

- Static answers add `X-Content-Type-Options: nosniff` and
  `Cache-Control: public, max-age=0, must-revalidate` (Authelia's own policy
  for assets); the content type comes from the extension, never from the
  bytes.
- `sub_filter` replaces exact strings Lamaste itself put there (`theme: light`
  is written explicitly into Authelia's configuration so the global value is
  known; `data-logooverride="true"` holds because `asset_path/logo.png` always
  exists, below). It touches `text/html` only (the module's default); the
  nonce and the CSP are Authelia's and unchanged. A domain without a brand
  gets `data-logooverride="false"` and no stylesheet: **exactly today's page**.
- `lamaste-priv` gains `sub_filter` (two quoted arguments, ≤ 512 bytes, no
  newline) and `sub_filter_once` in the `location` context; `root`,
  `try_files` and named locations are already allowed. The vhost tests
  (`nginx-vhosts.test.js`, `lamaste-priv.test.js`) cover the new lines.
- The startup reconcile (`vhost-reconcile.js`) already re-renders every auth
  vhost that differs from the generator, so an upgrade rolls the new vhost
  out without an operator step; activation of a new domain renders its
  (unbranded) vhost as today.

### Authelia's configuration

`server.asset_path: /etc/authelia/assets` (the panel owns `/etc/authelia`,
group `lamaste-authelia`, so Authelia reads what the panel writes) with one
file, `logo.png`, Lamaste's own logo (the desktop icon), written by the panel
with the configuration. It exists only to flip `data-logooverride` on at
Authelia's start; nginx decides per domain whether the visitor's page keeps
it. `theme: light` is written explicitly. Both are structural: the panel
adds them on the first start after the upgrade and restarts Authelia once
(`rewriteAutheliaConfig`, the path every structural change takes), audited
`authelia.restarted`.

### Gatekeeper's pages and the invitation page

- Gatekeeper reads `brand.json` of the host's domain (it already resolves the
  domain of a host from `domains.json`; fail open to the unbranded page) and
  renders the access-request and refusal pages with the name, the logo
  (`https://auth.<domain>/static/media/logo.png` — the one origin the page
  may trust, as the sign-out link does), the accent and the domain's support
  contact (else its own `adminEmail`/`adminName`).
- The invitation page is rendered per domain into the domain's directory;
  the auth vhost's `/invite/` alias points there. Its JavaScript and API are
  unchanged.

### API, CLI, panel

| Route                                                  | Purpose                                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/domains/:name/branding`                      | the record without the blobs: fields, `logo: {sha256, width, height}`, `favicon`, `revision`, `renderedAt`               |
| `PUT /api/domains/:name/branding`                      | the fields; `{ifRevision}` optional (409 `revision_mismatch`)                                                            |
| `PUT /api/domains/:name/branding/logo` · `/favicon`    | `{ data: <base64> }` (JSON on stdin for every curl-based client, under the panel's body limit); 400 `invalid_image`, 413 |
| `DELETE /api/domains/:name/branding/logo` · `/favicon` |                                                                                                                          |
| `DELETE /api/domains/:name/branding`                   | back to the stock page                                                                                                   |
| `GET /api/domains/:name/branding/preview`              | the rendered `brand.css` and the `en` title/footer, for the panel's preview                                              |

Audit `domain.branding.updated|removed` (field names, asset hashes — never
the bytes). CLI `lamaste-server domains branding <d>` (show), `… set
[--name … --tagline … --theme … --accent … --support-email …
--support-url …] [--clear <field>]… [--if-revision <n>]`, `… logo <file>
| --remove`, `… favicon <file> | --remove`, `… remove`, `… preview`.
Panel: a _Branding_ section on each card of the Domains page (name, tagline,
theme, accent, support, logo and favicon drops with a live preview of the
sign-in card). Desktop `admin_*` commands and the `AdminClient` interface
follow (web and desktop implement it, enforced at build time).

### Upgrade and reconcile

At start, after the domains are known: write `asset_path` + the placeholder
logo and `theme` if missing (one Authelia restart, once); for every brand
record, render its directory if its revision or the Authelia version differs
from `rendered.json`; remove directories of domains that lost their record;
the vhost reconcile re-renders the auth vhosts. The upgrade suite proves a
relay on 4.7.0 reaches 4.8.0 with its sign-in pages pixel-for-pixel stock
until a brand is set.

## Security review points

- The sign-in origin serves only panel-rendered bytes: validated images (no
  SVG, content type by extension, `nosniff`), generated CSS from a colour
  regex, locale JSON whose only operator text is a name that cannot carry
  tags or interpolation. No operator CSS or HTML ever reaches `auth.<domain>`
  (CSS on that origin could probe the page).
- The CSP Authelia sends is untouched; the stylesheet is allowed by
  `style-src 'self'`, nothing inline is added.
- `sub_filter` substitutes exact attribute strings only; the nonce is never
  touched; `Accept-Encoding` is cleared towards Authelia so the body is plain
  text (Authelia's index is not compressed anyway).
- Gatekeeper loads the logo only from `https://auth.<domain>/`, a host under
  a domain of this relay (a host under no domain gets no logo, as it gets no
  sign-in link, S12 of the multi-domain review).
- Logs name the domain and the hashes, never the image bytes or the name.

The panel's section and the CLI are described in `04-api-reference/domains.md` (In the panel; CLI).

## Decisions

| #   | Question                                                                   | Recommendation                                                                                                                                  |
| --- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Scope: Authelia pages only, or also the invitation and Gatekeeper pages?   | All three — a samplepark visitor meets the refusal page as surely as the sign-in.                                                               |
| D2  | Fields                                                                     | name, tagline, theme, accent, support e-mail/URL, logo, favicon. No free CSS/HTML, no background image, no fonts (v1).                          |
| D3  | "Powered by Authelia" footer on a branded domain                           | Hidden (Apache 2.0 needs no UI attribution). The locale title becomes "Login - <name>".                                                         |
| D4  | Rewrite the index HTML with `sub_filter` (theme, stylesheet, logo switch)? | Yes; create-lamaste checks `nginx -V` for `http_sub_module` at install and redeploy. Without it the design degrades to logo+favicon+texts only. |
| D5  | A domain without a brand                                                   | Exactly today's stock page (the placeholder logo is never shown).                                                                               |
| D6  | Where the operator sets it                                                 | Domains page, per card — a brand belongs to a domain.                                                                                           |
| D7  | Asset transport                                                            | base64 in JSON (every client already posts bodies on curl's stdin; 512 KiB logo cap fits the panel's limit).                                    |
| D8  | Branch and version                                                         | `feat/auth-branding` off `develop`, 4.8.0, waves below, one agent per wave.                                                                     |

## Waves

1. **core + serverd model**: validation (`auth-branding.ts`), image parsers, migration 0019, record CRUD, locale merge, tree rendering, Authelia `asset_path`/`theme`, start-up reconcile, routes, audit, tests, `04-api-reference/domains.md`.
2. **nginx**: vhost locations and `sub_filter`, `lamaste-priv` allow-list, create-lamaste module preflight, vhost and priv tests, `03-architecture/nginx-configuration.md`.
3. **Lamaste's own pages**: per-domain invitation page, Gatekeeper `brand.json` reader and branded templates, tests.
4. **Operator surfaces**: panel Domains page section with preview, `AdminClient` + web/desktop clients, CLI, docs.
5. **Rodeo**: three-VM spec (A and B branded differently: logo bytes, favicon, `en` and `tr` titles, `data-theme`, stylesheet, footer gone, refusal page branded; a third domain unbranded = stock), single-VM (validation refusals, reconcile after restart and after a removal), upgrade check. — `e2e-three-vm/52-auth-branding.sh` (140 of 140), `e2e/37-auth-branding-validation.sh` (95 of 95), `e2e-upgrade/01-panel-update.sh` extended (55 of 55), run on rodeo 2026-10-27 (`e2e-logs/test-52-auth-branding.md`).
