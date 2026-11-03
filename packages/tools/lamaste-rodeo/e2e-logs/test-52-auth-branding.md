# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-11-03 12:24:24 UTC`


## Pre-flight

✅ `12:24:24` Onboarding is complete  
✅ `12:24:24` Agent test-agent is enrolled on the host  
✅ `12:24:24` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `12:24:26` Domain lamaste-second.local added (201)  
✅ `12:24:26` …pending until activated  
✅ `12:24:26` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `12:24:26` …the one required record is auth.lamaste-second.local  
✅ `12:24:27` lamaste-second.local is active  
✅ `12:24:27` Domain lamaste-third.local added (201)  
✅ `12:24:27` …pending until activated  
✅ `12:24:27` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `12:24:27` …the one required record is auth.lamaste-third.local  
✅ `12:24:28` lamaste-third.local is active  
✅ `12:24:29` Four image fixtures written on the host VM, each with a digest  
✅ `12:24:29` …all four distinct  
✅ `12:24:29` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `12:24:29` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `12:24:30` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
✅ `12:24:30` …created at revision 1, dark, no warning  
✅ `12:24:31` PUT …/branding/logo: logo A (base64 in JSON)  
✅ `12:24:31` …revision 2, a 48×48 PNG, no warning  
✅ `12:24:31` …the answer's digest is the fixture's  
✅ `12:24:32` PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning  
✅ `12:24:33` PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else  
✅ `12:24:33` Logo B set — revision 2, the fixture's digest  
✅ `12:24:34` Favicon B set, a PNG — revision 3, the fixture's digest  
✅ `12:24:34` lamaste-third.local has no brand  
✅ `12:24:34` Both brands are rendered at their revision (renderedCurrent)  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `12:24:35` auth.test.lamaste.local/: 200  
✅ `12:24:35` …data-theme="dark" (A's theme)  
✅ `12:24:35` …data-logooverride="true" (A serves a logo)  
✅ `12:24:35` …links /brand.css  
✅ `12:24:35` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `12:24:35` …no light theme left anywhere in the page  
✅ `12:24:35` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `12:24:35` …data-logooverride="true" (B serves a logo)  
✅ `12:24:35` …links /brand.css  
✅ `12:24:35` auth.lamaste-third.local/: 200  
✅ `12:24:35` …data-theme="light" (the stock theme)  
✅ `12:24:35` …data-logooverride="false" (the placeholder is never shown)  
✅ `12:24:35` …no stylesheet: exactly the stock page  
✅ `12:24:35` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

✅ `12:24:35` auth.test.lamaste.local/brand.css: 200  
✅ `12:24:35` …text/css (by the extension)  
✅ `12:24:35` …X-Content-Type-Options: nosniff  
✅ `12:24:35` …Cache-Control: public, max-age=0, must-revalidate  
✅ `12:24:35` …--primary is A's accent  
✅ `12:24:35` …the "Powered by" footer link is hidden  
✅ `12:24:35` auth.lamaste-second.local/brand.css: --primary is B's accent  
✅ `12:24:35` auth.lamaste-third.local/brand.css: 404 (no brand, no stylesheet)  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

✅ `12:24:35` auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png  
✅ `12:24:35` auth.lamaste-second.local/static/media/logo.png: logo B's bytes  
✅ `12:24:35` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
✅ `12:24:36` auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon  
✅ `12:24:36` auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension  
✅ `12:24:36` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `12:24:36` …not favicon A  
✅ `12:24:36` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

✅ `12:24:36` auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A"  
✅ `12:24:36` …"Powered by {{authelia}}" → "Powered by Brand A"  
✅ `12:24:36` …no {{authelia}} left in any value  
✅ `12:24:36` auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - Brand A)  
✅ `12:24:36` …and no placeholder  
✅ `12:24:36` auth.lamaste-second.local/locales/en/portal.json says Brand B  
✅ `12:24:36` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `12:24:36` …no brand of another domain  
✅ `12:24:36` auth.test.lamaste.local/locales/en/settings.json carries Brand A too  

## The invitation page: A's branded, C's the stock page, the same script

✅ `12:24:36` auth.test.lamaste.local/invite/x: 200  
✅ `12:24:37` …titled Brand A — Accept Invitation  
✅ `12:24:37` …the brand's name in the header  
✅ `12:24:37` …and its tagline  
✅ `12:24:37` …the logo from the same origin  
✅ `12:24:37` …its colours from /brand.css (the inline style is one text for every brand: one CSP hash a release)  
✅ `12:24:37` …which carries the accent  
✅ `12:24:37` auth.lamaste-third.local/invite/x: 200  
✅ `12:24:37` …the stock page  
✅ `12:24:37` …no brand header  
✅ `12:24:37` Both pages carry a script of the same length  
✅ `12:24:37` …byte for byte the same script (the API calls, and the CSP hash, are one)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `12:24:37` User e2e52-a created, member of test.lamaste.local  
✅ `12:24:37` e2e52-a has a directory id  
✅ `12:24:38` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `12:24:39` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `12:24:40` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `12:24:42` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `12:25:02` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `12:25:32` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `12:25:32` e2e52-a (a member of A) on B's tunnel: 403  
✅ `12:25:33` …the domain refusal page  
✅ `12:25:33` …naming lamaste-second.local  
✅ `12:25:33` …never a redirect to a sign-in page (no login loop)  
✅ `12:25:33` …titled with Brand B  
✅ `12:25:33` …Brand B in the header  
✅ `12:25:33` …the logo from B's sign-in host  
✅ `12:25:33` …B's accent  
✅ `12:25:33` …no Help link (B names no support URL)  
✅ `12:25:33` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `12:25:33` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `12:25:33` …the access-request page  
✅ `12:25:33` …not the domain refusal  
✅ `12:25:33` …never a redirect to a sign-in page  
✅ `12:25:33` …titled with Brand A  
✅ `12:25:33` …Brand A in the header  
✅ `12:25:33` …its tagline  
✅ `12:25:33` …the logo from A's sign-in host  
✅ `12:25:33` …A's accent  
✅ `12:25:33` …the brand's support e-mail as the contact  
✅ `12:25:33` …and its support URL as the Help link  

## On C's tunnel the refusal is the stock page

✅ `12:25:33` e2e52-a on C's tunnel: 403  
✅ `12:25:33` …the domain refusal page  
✅ `12:25:33` …naming lamaste-third.local  
✅ `12:25:33` …never a redirect to a sign-in page (no login loop)  
✅ `12:25:33` …titled without a brand  
✅ `12:25:33` …no brand header  
✅ `12:25:33` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

✅ `12:25:34` PUT …/branding with theme oled: revision 4, no warning  
✅ `12:25:34` auth.test.lamaste.local/ says data-theme="oled"  
✅ `12:25:34` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `12:25:34` …and keeps the logo switch on  
✅ `12:25:34` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

✅ `12:25:35` DELETE …/branding/logo: removed, revision 5, no warning  
✅ `12:25:35` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `12:25:35` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `12:25:35` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `12:25:35` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `12:25:36` GET says lamaste-second.local has no brand  
✅ `12:25:36` auth.lamaste-second.local/ is the stock page: data-logooverride="false", no stylesheet  
✅ `12:25:36` …data-theme="light"  
✅ `12:25:36` auth.lamaste-second.local/brand.css: 404  
✅ `12:25:36` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `12:25:36` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `12:25:36` No rendering of lamaste-second.local is left under .renders/  
✅ `12:25:36` Exactly one rendering of test.lamaste.local serves (the previous ones removed)  

## The audit names fields and digests, never the name or the bytes

✅ `12:25:37` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `12:25:37` …the field entries name the fields (name, theme, accent, …)  
✅ `12:25:37` …the logo entry carries its digest  
✅ `12:25:37` …and the removal is one entry  
✅ `12:25:37` …revisions 1 to 5  
✅ `12:25:37` …no entry carries the brand's name  
✅ `12:25:37` …nor the logo's bytes  
✅ `12:25:37` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `12:25:37` Cleaning up test resources...  
