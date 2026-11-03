# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-11-03 10:40:09 UTC`


## Pre-flight

✅ `10:40:09` Onboarding is complete  
✅ `10:40:09` Agent test-agent is enrolled on the host  
✅ `10:40:09` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `10:40:10` Domain lamaste-second.local added (201)  
✅ `10:40:10` …pending until activated  
✅ `10:40:10` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:40:10` …the one required record is auth.lamaste-second.local  
✅ `10:40:11` lamaste-second.local is active  
✅ `10:40:12` Domain lamaste-third.local added (201)  
✅ `10:40:12` …pending until activated  
✅ `10:40:12` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `10:40:12` …the one required record is auth.lamaste-third.local  
✅ `10:40:13` lamaste-third.local is active  
✅ `10:40:14` Four image fixtures written on the host VM, each with a digest  
✅ `10:40:14` …all four distinct  
✅ `10:40:14` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `10:40:14` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `10:40:15` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
✅ `10:40:15` …created at revision 1, dark, no warning  
✅ `10:40:16` PUT …/branding/logo: logo A (base64 in JSON)  
✅ `10:40:16` …revision 2, a 48×48 PNG, no warning  
✅ `10:40:16` …the answer's digest is the fixture's  
✅ `10:40:16` PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning  
✅ `10:40:17` PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else  
✅ `10:40:18` Logo B set — revision 2, the fixture's digest  
✅ `10:40:19` Favicon B set, a PNG — revision 3, the fixture's digest  
✅ `10:40:19` lamaste-third.local has no brand  
✅ `10:40:19` Both brands are rendered at their revision (renderedCurrent)  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `10:40:19` auth.test.lamaste.local/: 200  
✅ `10:40:19` …data-theme="dark" (A's theme)  
✅ `10:40:19` …data-logooverride="true" (A serves a logo)  
✅ `10:40:19` …links /brand.css  
✅ `10:40:19` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `10:40:19` …no light theme left anywhere in the page  
✅ `10:40:19` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `10:40:19` …data-logooverride="true" (B serves a logo)  
✅ `10:40:19` …links /brand.css  
✅ `10:40:19` auth.lamaste-third.local/: 200  
✅ `10:40:19` …data-theme="light" (the stock theme)  
✅ `10:40:19` …data-logooverride="false" (the placeholder is never shown)  
✅ `10:40:19` …no stylesheet: exactly the stock page  
✅ `10:40:19` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

✅ `10:40:20` auth.test.lamaste.local/brand.css: 200  
✅ `10:40:20` …text/css (by the extension)  
✅ `10:40:20` …X-Content-Type-Options: nosniff  
✅ `10:40:20` …Cache-Control: public, max-age=0, must-revalidate  
✅ `10:40:20` …--primary is A's accent  
✅ `10:40:20` …the "Powered by" footer link is hidden  
✅ `10:40:20` auth.lamaste-second.local/brand.css: --primary is B's accent  
✅ `10:40:20` auth.lamaste-third.local/brand.css: 404 (no brand, no stylesheet)  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

✅ `10:40:20` auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png  
✅ `10:40:20` auth.lamaste-second.local/static/media/logo.png: logo B's bytes  
✅ `10:40:20` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
✅ `10:40:20` auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon  
✅ `10:40:20` auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension  
✅ `10:40:21` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `10:40:21` …not favicon A  
✅ `10:40:21` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

✅ `10:40:21` auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A"  
✅ `10:40:21` …"Powered by {{authelia}}" → "Powered by Brand A"  
✅ `10:40:21` …no {{authelia}} left in any value  
✅ `10:40:21` auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - Brand A)  
✅ `10:40:21` …and no placeholder  
✅ `10:40:21` auth.lamaste-second.local/locales/en/portal.json says Brand B  
✅ `10:40:21` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `10:40:21` …no brand of another domain  
✅ `10:40:21` auth.test.lamaste.local/locales/en/settings.json carries Brand A too  

## The invitation page: A's branded, C's the stock page, the same script

✅ `10:40:21` auth.test.lamaste.local/invite/x: 200  
✅ `10:40:21` …titled Brand A — Accept Invitation  
✅ `10:40:21` …the brand's name in the header  
✅ `10:40:21` …and its tagline  
✅ `10:40:21` …the logo from the same origin  
✅ `10:40:21` …its colours from /brand.css (the inline style is one text for every brand: one CSP hash a release)  
✅ `10:40:21` …which carries the accent  
✅ `10:40:22` auth.lamaste-third.local/invite/x: 200  
✅ `10:40:22` …the stock page  
✅ `10:40:22` …no brand header  
✅ `10:40:22` Both pages carry a script of the same length  
✅ `10:40:22` …byte for byte the same script (the API calls, and the CSP hash, are one)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `10:40:22` User e2e52-a created, member of test.lamaste.local  
✅ `10:40:22` e2e52-a has a directory id  
✅ `10:40:24` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:40:26` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `10:40:28` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `10:40:30` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:41:03` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:41:33` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `10:41:33` e2e52-a (a member of A) on B's tunnel: 403  
✅ `10:41:33` …the domain refusal page  
✅ `10:41:33` …naming lamaste-second.local  
✅ `10:41:33` …never a redirect to a sign-in page (no login loop)  
✅ `10:41:33` …titled with Brand B  
✅ `10:41:33` …Brand B in the header  
✅ `10:41:33` …the logo from B's sign-in host  
✅ `10:41:33` …B's accent  
✅ `10:41:33` …no Help link (B names no support URL)  
✅ `10:41:33` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `10:41:33` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `10:41:33` …the access-request page  
✅ `10:41:33` …not the domain refusal  
✅ `10:41:33` …never a redirect to a sign-in page  
✅ `10:41:33` …titled with Brand A  
✅ `10:41:33` …Brand A in the header  
✅ `10:41:33` …its tagline  
✅ `10:41:33` …the logo from A's sign-in host  
✅ `10:41:33` …A's accent  
✅ `10:41:33` …the brand's support e-mail as the contact  
✅ `10:41:33` …and its support URL as the Help link  

## On C's tunnel the refusal is the stock page

✅ `10:41:33` e2e52-a on C's tunnel: 403  
✅ `10:41:33` …the domain refusal page  
✅ `10:41:33` …naming lamaste-third.local  
✅ `10:41:33` …never a redirect to a sign-in page (no login loop)  
✅ `10:41:33` …titled without a brand  
✅ `10:41:33` …no brand header  
✅ `10:41:33` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

✅ `10:41:34` PUT …/branding with theme oled: revision 4, no warning  
✅ `10:41:34` auth.test.lamaste.local/ says data-theme="oled"  
✅ `10:41:34` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `10:41:34` …and keeps the logo switch on  
✅ `10:41:34` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

✅ `10:41:35` DELETE …/branding/logo: removed, revision 5, no warning  
✅ `10:41:35` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `10:41:35` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `10:41:35` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `10:41:36` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `10:41:36` GET says lamaste-second.local has no brand  
✅ `10:41:36` auth.lamaste-second.local/ is the stock page: data-logooverride="false", no stylesheet  
✅ `10:41:36` …data-theme="light"  
✅ `10:41:36` auth.lamaste-second.local/brand.css: 404  
✅ `10:41:36` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `10:41:36` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `10:41:36` No rendering of lamaste-second.local is left under .renders/  
✅ `10:41:36` Exactly one rendering of test.lamaste.local serves (the previous ones removed)  

## The audit names fields and digests, never the name or the bytes

✅ `10:41:37` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `10:41:37` …the field entries name the fields (name, theme, accent, …)  
✅ `10:41:37` …the logo entry carries its digest  
✅ `10:41:37` …and the removal is one entry  
✅ `10:41:37` …revisions 1 to 5  
✅ `10:41:37` …no entry carries the brand's name  
✅ `10:41:37` …nor the logo's bytes  
✅ `10:41:37` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `10:41:37` Cleaning up test resources...  
