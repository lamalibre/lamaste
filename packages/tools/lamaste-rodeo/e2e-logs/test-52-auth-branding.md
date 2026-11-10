# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-11-10 14:17:27 UTC`


## Pre-flight

✅ `14:17:27` Onboarding is complete  
✅ `14:17:27` Agent test-agent is enrolled on the host  
✅ `14:17:28` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `14:17:29` Domain lamaste-second.local added (201)  
✅ `14:17:29` …pending until activated  
✅ `14:17:29` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:17:29` …the one required record is auth.lamaste-second.local  
✅ `14:17:30` lamaste-second.local is active  
✅ `14:17:31` Domain lamaste-third.local added (201)  
✅ `14:17:31` …pending until activated  
✅ `14:17:31` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `14:17:31` …the one required record is auth.lamaste-third.local  
✅ `14:17:32` lamaste-third.local is active  
✅ `14:17:33` Four image fixtures written on the host VM, each with a digest  
✅ `14:17:33` …all four distinct  
✅ `14:17:33` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `14:17:33` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `14:17:35` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
✅ `14:17:35` …created at revision 1, dark, no warning  
✅ `14:17:36` PUT …/branding/logo: logo A (base64 in JSON)  
✅ `14:17:36` …revision 2, a 48×48 PNG, no warning  
✅ `14:17:36` …the answer's digest is the fixture's  
✅ `14:17:38` PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning  
✅ `14:17:39` PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else  
✅ `14:17:40` Logo B set — revision 2, the fixture's digest  
✅ `14:17:42` Favicon B set, a PNG — revision 3, the fixture's digest  
✅ `14:17:42` lamaste-third.local has no brand  
✅ `14:17:42` Both brands are rendered at their revision (renderedCurrent)  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `14:17:42` auth.test.lamaste.local/: 200  
✅ `14:17:42` …data-theme="dark" (A's theme)  
✅ `14:17:42` …data-logooverride="true" (A serves a logo)  
✅ `14:17:42` …links /brand.css  
✅ `14:17:42` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `14:17:42` …no light theme left anywhere in the page  
✅ `14:17:42` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `14:17:42` …data-logooverride="true" (B serves a logo)  
✅ `14:17:42` …links /brand.css  
✅ `14:17:43` auth.lamaste-third.local/: 200  
✅ `14:17:43` …data-theme="light" (the stock theme)  
✅ `14:17:43` …data-logooverride="false" (the placeholder is never shown)  
✅ `14:17:43` …no stylesheet: exactly the stock page  
✅ `14:17:43` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

✅ `14:17:43` auth.test.lamaste.local/brand.css: 200  
✅ `14:17:43` …text/css (by the extension)  
✅ `14:17:43` …X-Content-Type-Options: nosniff  
✅ `14:17:43` …Cache-Control: public, max-age=0, must-revalidate  
✅ `14:17:43` …--primary is A's accent  
✅ `14:17:43` …the "Powered by" footer link is hidden  
✅ `14:17:43` auth.lamaste-second.local/brand.css: --primary is B's accent  
✅ `14:17:43` auth.lamaste-third.local/brand.css: 404 (no brand, no stylesheet)  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

✅ `14:17:43` auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png  
✅ `14:17:43` auth.lamaste-second.local/static/media/logo.png: logo B's bytes  
✅ `14:17:43` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
✅ `14:17:44` auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon  
✅ `14:17:44` auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension  
✅ `14:17:44` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `14:17:44` …not favicon A  
✅ `14:17:44` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

✅ `14:17:44` auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A"  
✅ `14:17:44` …"Powered by {{authelia}}" → "Powered by Brand A"  
✅ `14:17:44` …no {{authelia}} left in any value  
✅ `14:17:44` auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - Brand A)  
✅ `14:17:44` …and no placeholder  
✅ `14:17:44` auth.lamaste-second.local/locales/en/portal.json says Brand B  
✅ `14:17:45` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `14:17:45` …no brand of another domain  
✅ `14:17:45` auth.test.lamaste.local/locales/en/settings.json carries Brand A too  

## The invitation page: A's branded, C's the stock page, the same script

✅ `14:17:45` auth.test.lamaste.local/invite/x: 200  
✅ `14:17:45` …titled Brand A — Accept Invitation  
✅ `14:17:45` …the brand's name in the header  
✅ `14:17:45` …and its tagline  
✅ `14:17:45` …the logo from the same origin  
✅ `14:17:45` …its colours from /brand.css (the inline style is one text for every brand: one CSP hash a release)  
✅ `14:17:45` …which carries the accent  
✅ `14:17:45` auth.lamaste-third.local/invite/x: 200  
✅ `14:17:45` …the stock page  
✅ `14:17:45` …no brand header  
✅ `14:17:45` Both pages carry a script of the same length  
✅ `14:17:45` …byte for byte the same script (the API calls, and the CSP hash, are one)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `14:17:46` User e2e52-a created, member of test.lamaste.local  
✅ `14:17:46` e2e52-a has a directory id  
✅ `14:17:48` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:17:51` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `14:17:53` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `14:17:56` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:18:03` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:18:33` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `14:18:33` e2e52-a (a member of A) on B's tunnel: 403  
✅ `14:18:33` …the domain refusal page  
✅ `14:18:33` …naming lamaste-second.local  
✅ `14:18:33` …never a redirect to a sign-in page (no login loop)  
✅ `14:18:33` …titled with Brand B  
✅ `14:18:33` …Brand B in the header  
✅ `14:18:33` …the logo from B's sign-in host  
✅ `14:18:33` …B's accent  
✅ `14:18:33` …no Help link (B names no support URL)  
✅ `14:18:33` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `14:18:33` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `14:18:33` …the access-request page  
✅ `14:18:33` …not the domain refusal  
✅ `14:18:33` …never a redirect to a sign-in page  
✅ `14:18:33` …titled with Brand A  
✅ `14:18:33` …Brand A in the header  
✅ `14:18:33` …its tagline  
✅ `14:18:33` …the logo from A's sign-in host  
✅ `14:18:33` …A's accent  
✅ `14:18:33` …the brand's support e-mail as the contact  
✅ `14:18:33` …and its support URL as the Help link  

## On C's tunnel the refusal is the stock page

✅ `14:18:34` e2e52-a on C's tunnel: 403  
✅ `14:18:34` …the domain refusal page  
✅ `14:18:34` …naming lamaste-third.local  
✅ `14:18:34` …never a redirect to a sign-in page (no login loop)  
✅ `14:18:34` …titled without a brand  
✅ `14:18:34` …no brand header  
✅ `14:18:34` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

✅ `14:18:35` PUT …/branding with theme oled: revision 4, no warning  
✅ `14:18:35` auth.test.lamaste.local/ says data-theme="oled"  
✅ `14:18:35` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `14:18:35` …and keeps the logo switch on  
✅ `14:18:36` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

✅ `14:18:37` DELETE …/branding/logo: removed, revision 5, no warning  
✅ `14:18:37` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `14:18:37` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `14:18:37` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `14:18:38` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `14:18:38` GET says lamaste-second.local has no brand  
✅ `14:18:38` auth.lamaste-second.local/ is the stock page: data-logooverride="false", no stylesheet  
✅ `14:18:38` …data-theme="light"  
✅ `14:18:38` auth.lamaste-second.local/brand.css: 404  
✅ `14:18:39` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `14:18:39` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `14:18:39` No rendering of lamaste-second.local is left under .renders/  
✅ `14:18:39` Exactly one rendering of test.lamaste.local serves (the previous ones removed)  

## The audit names fields and digests, never the name or the bytes

✅ `14:18:39` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `14:18:39` …the field entries name the fields (name, theme, accent, …)  
✅ `14:18:39` …the logo entry carries its digest  
✅ `14:18:39` …and the removal is one entry  
✅ `14:18:39` …revisions 1 to 5  
✅ `14:18:39` …no entry carries the brand's name  
✅ `14:18:39` …nor the logo's bytes  
✅ `14:18:39` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `14:18:39` Cleaning up test resources...  
