-- A domain's brand on its auth pages (packages/core/docs/auth-branding-design.md;
-- lib/auth-branding.js): what a visitor of `auth.<domain>` sees — the name
-- spliced into Authelia's texts, the colours, the logo and favicon — and
-- what Lamaste's own pages for the domain show. One brand per domain; it
-- goes with the domain. The record is the source of truth: the files nginx
-- serves under /var/www/lamaste/auth/<domain>/ are a rendering of it,
-- rebuilt at every change (`revision`) and reconciled at start.
CREATE TABLE domain_branding (
  domain          TEXT PRIMARY KEY REFERENCES domains(name) ON DELETE CASCADE,
  name            TEXT NOT NULL,            -- 'Code Lama' — the brand's name
  tagline         TEXT,                     -- optional, under the name on Lamaste's own pages
  theme           TEXT NOT NULL             -- Authelia's theme for the domain's sign-in
                  CHECK (theme IN ('light', 'dark', 'grey', 'oled', 'auto')),
  accent          TEXT,                     -- '#rrggbb' — buttons, focus rings, links
  support_email   TEXT,                     -- shown on refusal pages (else Gatekeeper's adminEmail)
  support_url     TEXT,                     -- https:// only
  logo            BLOB,                     -- PNG <= 512 KiB, <= 1024x1024
  logo_sha256     TEXT,
  favicon         BLOB,                     -- ICO or PNG <= 64 KiB
  favicon_sha256  TEXT,
  revision        INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL,
  CHECK ((logo IS NULL) = (logo_sha256 IS NULL)),
  CHECK ((favicon IS NULL) = (favicon_sha256 IS NULL))
);
