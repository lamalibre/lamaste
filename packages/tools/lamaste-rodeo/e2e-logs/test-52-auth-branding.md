# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-11-09 13:51:32 UTC`


## Pre-flight

✅ `13:51:32` Onboarding is complete  
✅ `13:51:33` Agent test-agent is enrolled on the host  
✅ `13:51:33` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `13:51:34` Domain lamaste-second.local added (201)  
✅ `13:51:34` …pending until activated  
✅ `13:51:34` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:51:34` …the one required record is auth.lamaste-second.local  
✅ `13:51:35` lamaste-second.local is active  
✅ `13:51:36` Domain lamaste-third.local added (201)  
✅ `13:51:36` …pending until activated  
✅ `13:51:36` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `13:51:36` …the one required record is auth.lamaste-third.local  
✅ `13:51:37` lamaste-third.local is active  
✅ `13:51:37` Four image fixtures written on the host VM, each with a digest  
✅ `13:51:37` …all four distinct  
✅ `13:51:38` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `13:51:38` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `13:51:39` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
✅ `13:51:39` …created at revision 1, dark, no warning  
✅ `13:51:40` PUT …/branding/logo: logo A (base64 in JSON)  
✅ `13:51:40` …revision 2, a 48×48 PNG, no warning  
✅ `13:51:40` …the answer's digest is the fixture's  
✅ `13:51:40` PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning  
✅ `13:51:41` PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else  
✅ `13:51:42` Logo B set — revision 2, the fixture's digest  
✅ `13:51:43` Favicon B set, a PNG — revision 3, the fixture's digest  
✅ `13:51:43` lamaste-third.local has no brand  
✅ `13:51:43` Both brands are rendered at their revision (renderedCurrent)  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `13:51:43` auth.test.lamaste.local/: 200  
✅ `13:51:43` …data-theme="dark" (A's theme)  
✅ `13:51:43` …data-logooverride="true" (A serves a logo)  
✅ `13:51:43` …links /brand.css  
✅ `13:51:43` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `13:51:43` …no light theme left anywhere in the page  
✅ `13:51:43` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `13:51:43` …data-logooverride="true" (B serves a logo)  
✅ `13:51:43` …links /brand.css  
✅ `13:51:44` auth.lamaste-third.local/: 200  
✅ `13:51:44` …data-theme="light" (the stock theme)  
✅ `13:51:44` …data-logooverride="false" (the placeholder is never shown)  
✅ `13:51:44` …no stylesheet: exactly the stock page  
✅ `13:51:44` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

✅ `13:51:44` auth.test.lamaste.local/brand.css: 200  
✅ `13:51:44` …text/css (by the extension)  
✅ `13:51:44` …X-Content-Type-Options: nosniff  
✅ `13:51:44` …Cache-Control: public, max-age=0, must-revalidate  
✅ `13:51:44` …--primary is A's accent  
✅ `13:51:44` …the "Powered by" footer link is hidden  
✅ `13:51:44` auth.lamaste-second.local/brand.css: --primary is B's accent  
✅ `13:51:44` auth.lamaste-third.local/brand.css: 404 (no brand, no stylesheet)  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

✅ `13:51:44` auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png  
✅ `13:51:44` auth.lamaste-second.local/static/media/logo.png: logo B's bytes  
✅ `13:51:44` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
✅ `13:51:44` auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon  
✅ `13:51:44` auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension  
✅ `13:51:44` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `13:51:44` …not favicon A  
✅ `13:51:44` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

✅ `13:51:45` auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A"  
✅ `13:51:45` …"Powered by {{authelia}}" → "Powered by Brand A"  
✅ `13:51:45` …no {{authelia}} left in any value  
✅ `13:51:45` auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - Brand A)  
✅ `13:51:45` …and no placeholder  
✅ `13:51:45` auth.lamaste-second.local/locales/en/portal.json says Brand B  
✅ `13:51:45` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `13:51:45` …no brand of another domain  
✅ `13:51:45` auth.test.lamaste.local/locales/en/settings.json carries Brand A too  

## The invitation page: A's branded, C's the stock page, the same script

✅ `13:51:45` auth.test.lamaste.local/invite/x: 200  
✅ `13:51:45` …titled Brand A — Accept Invitation  
✅ `13:51:45` …the brand's name in the header  
✅ `13:51:45` …and its tagline  
✅ `13:51:45` …the logo from the same origin  
✅ `13:51:45` …its colours from /brand.css (the inline style is one text for every brand: one CSP hash a release)  
✅ `13:51:45` …which carries the accent  
✅ `13:51:45` auth.lamaste-third.local/invite/x: 200  
✅ `13:51:45` …the stock page  
✅ `13:51:45` …no brand header  
✅ `13:51:45` Both pages carry a script of the same length  
✅ `13:51:45` …byte for byte the same script (the API calls, and the CSP hash, are one)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `13:51:46` User e2e52-a created, member of test.lamaste.local  
✅ `13:51:46` e2e52-a has a directory id  
✅ `13:51:48` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `13:51:50` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `13:51:52` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `13:51:54` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:52:03` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:52:33` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `13:52:33` e2e52-a (a member of A) on B's tunnel: 403  
✅ `13:52:33` …the domain refusal page  
✅ `13:52:33` …naming lamaste-second.local  
✅ `13:52:33` …never a redirect to a sign-in page (no login loop)  
✅ `13:52:33` …titled with Brand B  
✅ `13:52:33` …Brand B in the header  
✅ `13:52:33` …the logo from B's sign-in host  
✅ `13:52:33` …B's accent  
✅ `13:52:33` …no Help link (B names no support URL)  
✅ `13:52:33` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `13:52:33` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `13:52:33` …the access-request page  
✅ `13:52:33` …not the domain refusal  
✅ `13:52:33` …never a redirect to a sign-in page  
✅ `13:52:33` …titled with Brand A  
✅ `13:52:33` …Brand A in the header  
✅ `13:52:33` …its tagline  
✅ `13:52:33` …the logo from A's sign-in host  
✅ `13:52:33` …A's accent  
✅ `13:52:33` …the brand's support e-mail as the contact  
✅ `13:52:33` …and its support URL as the Help link  

## On C's tunnel the refusal is the stock page

✅ `13:52:33` e2e52-a on C's tunnel: 403  
✅ `13:52:33` …the domain refusal page  
✅ `13:52:33` …naming lamaste-third.local  
✅ `13:52:33` …never a redirect to a sign-in page (no login loop)  
✅ `13:52:33` …titled without a brand  
✅ `13:52:33` …no brand header  
✅ `13:52:33` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

✅ `13:52:34` PUT …/branding with theme oled: revision 4, no warning  
✅ `13:52:34` auth.test.lamaste.local/ says data-theme="oled"  
✅ `13:52:34` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `13:52:34` …and keeps the logo switch on  
✅ `13:52:34` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

✅ `13:52:35` DELETE …/branding/logo: removed, revision 5, no warning  
✅ `13:52:38` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `13:52:38` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `13:52:38` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `13:52:39` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `13:52:39` GET says lamaste-second.local has no brand  
✅ `13:52:39` auth.lamaste-second.local/ is the stock page: data-logooverride="false", no stylesheet  
✅ `13:52:39` …data-theme="light"  
✅ `13:52:39` auth.lamaste-second.local/brand.css: 404  
✅ `13:52:39` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `13:52:39` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `13:52:39` No rendering of lamaste-second.local is left under .renders/  
✅ `13:52:40` Exactly one rendering of test.lamaste.local serves (the previous ones removed)  

## The audit names fields and digests, never the name or the bytes

✅ `13:52:40` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `13:52:40` …the field entries name the fields (name, theme, accent, …)  
✅ `13:52:40` …the logo entry carries its digest  
✅ `13:52:40` …and the removal is one entry  
✅ `13:52:40` …revisions 1 to 5  
✅ `13:52:40` …no entry carries the brand's name  
✅ `13:52:40` …nor the logo's bytes  
✅ `13:52:40` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `13:52:40` Cleaning up test resources...  
