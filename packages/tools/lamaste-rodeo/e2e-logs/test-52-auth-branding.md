# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-11-10 19:00:43 UTC`


## Pre-flight

✅ `19:00:43` Onboarding is complete  
✅ `19:00:44` Agent test-agent is enrolled on the host  
✅ `19:00:44` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `19:00:45` Domain lamaste-second.local added (201)  
✅ `19:00:45` …pending until activated  
✅ `19:00:45` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `19:00:45` …the one required record is auth.lamaste-second.local  
✅ `19:00:46` lamaste-second.local is active  
✅ `19:00:47` Domain lamaste-third.local added (201)  
✅ `19:00:47` …pending until activated  
✅ `19:00:47` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `19:00:47` …the one required record is auth.lamaste-third.local  
✅ `19:00:49` lamaste-third.local is active  
✅ `19:00:50` Four image fixtures written on the host VM, each with a digest  
✅ `19:00:50` …all four distinct  
✅ `19:00:50` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `19:00:50` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `19:00:52` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
✅ `19:00:52` …created at revision 1, dark, no warning  
✅ `19:00:53` PUT …/branding/logo: logo A (base64 in JSON)  
✅ `19:00:53` …revision 2, a 48×48 PNG, no warning  
✅ `19:00:53` …the answer's digest is the fixture's  
✅ `19:00:54` PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning  
✅ `19:00:56` PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else  
✅ `19:00:57` Logo B set — revision 2, the fixture's digest  
✅ `19:00:59` Favicon B set, a PNG — revision 3, the fixture's digest  
✅ `19:00:59` lamaste-third.local has no brand  
✅ `19:00:59` Both brands are rendered at their revision (renderedCurrent)  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `19:00:59` auth.test.lamaste.local/: 200  
✅ `19:00:59` …data-theme="dark" (A's theme)  
✅ `19:00:59` …data-logooverride="true" (A serves a logo)  
✅ `19:00:59` …links /brand.css  
✅ `19:00:59` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `19:00:59` …no light theme left anywhere in the page  
✅ `19:00:59` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `19:00:59` …data-logooverride="true" (B serves a logo)  
✅ `19:00:59` …links /brand.css  
✅ `19:01:00` auth.lamaste-third.local/: 200  
✅ `19:01:00` …data-theme="light" (the stock theme)  
✅ `19:01:00` …data-logooverride="false" (the placeholder is never shown)  
✅ `19:01:00` …no stylesheet: exactly the stock page  
✅ `19:01:00` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

✅ `19:01:00` auth.test.lamaste.local/brand.css: 200  
✅ `19:01:00` …text/css (by the extension)  
✅ `19:01:00` …X-Content-Type-Options: nosniff  
✅ `19:01:00` …Cache-Control: public, max-age=0, must-revalidate  
✅ `19:01:00` …--primary is A's accent  
✅ `19:01:00` …the "Powered by" footer link is hidden  
✅ `19:01:00` auth.lamaste-second.local/brand.css: --primary is B's accent  
✅ `19:01:00` auth.lamaste-third.local/brand.css: 404 (no brand, no stylesheet)  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

✅ `19:01:00` auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png  
✅ `19:01:00` auth.lamaste-second.local/static/media/logo.png: logo B's bytes  
✅ `19:01:00` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
✅ `19:01:01` auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon  
✅ `19:01:01` auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension  
✅ `19:01:01` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `19:01:01` …not favicon A  
✅ `19:01:01` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

✅ `19:01:01` auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A"  
✅ `19:01:01` …"Powered by {{authelia}}" → "Powered by Brand A"  
✅ `19:01:01` …no {{authelia}} left in any value  
✅ `19:01:01` auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - Brand A)  
✅ `19:01:01` …and no placeholder  
✅ `19:01:01` auth.lamaste-second.local/locales/en/portal.json says Brand B  
✅ `19:01:02` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `19:01:02` …no brand of another domain  
✅ `19:01:02` auth.test.lamaste.local/locales/en/settings.json carries Brand A too  

## The invitation page: A's branded, C's the stock page, the same script

✅ `19:01:02` auth.test.lamaste.local/invite/x: 200  
✅ `19:01:02` …titled Brand A — Accept Invitation  
✅ `19:01:02` …the brand's name in the header  
✅ `19:01:02` …and its tagline  
✅ `19:01:02` …the logo from the same origin  
✅ `19:01:02` …its colours from /brand.css (the inline style is one text for every brand: one CSP hash a release)  
✅ `19:01:02` …which carries the accent  
✅ `19:01:02` auth.lamaste-third.local/invite/x: 200  
✅ `19:01:02` …the stock page  
✅ `19:01:02` …no brand header  
✅ `19:01:02` Both pages carry a script of the same length  
✅ `19:01:02` …byte for byte the same script (the API calls, and the CSP hash, are one)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `19:01:03` User e2e52-a created, member of test.lamaste.local  
✅ `19:01:03` e2e52-a has a directory id  
✅ `19:01:06` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `19:01:08` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `19:01:11` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `19:01:13` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:01:33` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `19:02:03` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `19:02:04` e2e52-a (a member of A) on B's tunnel: 403  
✅ `19:02:04` …the domain refusal page  
✅ `19:02:04` …naming lamaste-second.local  
✅ `19:02:04` …never a redirect to a sign-in page (no login loop)  
✅ `19:02:04` …titled with Brand B  
✅ `19:02:04` …Brand B in the header  
✅ `19:02:04` …the logo from B's sign-in host  
✅ `19:02:04` …B's accent  
✅ `19:02:04` …no Help link (B names no support URL)  
✅ `19:02:04` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `19:02:04` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `19:02:04` …the access-request page  
✅ `19:02:04` …not the domain refusal  
✅ `19:02:04` …never a redirect to a sign-in page  
✅ `19:02:04` …titled with Brand A  
✅ `19:02:04` …Brand A in the header  
✅ `19:02:04` …its tagline  
✅ `19:02:04` …the logo from A's sign-in host  
✅ `19:02:04` …A's accent  
✅ `19:02:04` …the brand's support e-mail as the contact  
✅ `19:02:04` …and its support URL as the Help link  

## On C's tunnel the refusal is the stock page

✅ `19:02:04` e2e52-a on C's tunnel: 403  
✅ `19:02:04` …the domain refusal page  
✅ `19:02:04` …naming lamaste-third.local  
✅ `19:02:04` …never a redirect to a sign-in page (no login loop)  
✅ `19:02:04` …titled without a brand  
✅ `19:02:04` …no brand header  
✅ `19:02:04` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

✅ `19:02:06` PUT …/branding with theme oled: revision 4, no warning  
✅ `19:02:06` auth.test.lamaste.local/ says data-theme="oled"  
✅ `19:02:06` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `19:02:06` …and keeps the logo switch on  
✅ `19:02:06` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

✅ `19:02:07` DELETE …/branding/logo: removed, revision 5, no warning  
✅ `19:02:08` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `19:02:08` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `19:02:08` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `19:02:08` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `19:02:08` GET says lamaste-second.local has no brand  
✅ `19:02:09` auth.lamaste-second.local/ is the stock page: data-logooverride="false", no stylesheet  
✅ `19:02:09` …data-theme="light"  
✅ `19:02:09` auth.lamaste-second.local/brand.css: 404  
✅ `19:02:09` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `19:02:09` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `19:02:09` No rendering of lamaste-second.local is left under .renders/  
✅ `19:02:09` Exactly one rendering of test.lamaste.local serves (the previous ones removed)  

## The audit names fields and digests, never the name or the bytes

✅ `19:02:10` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `19:02:10` …the field entries name the fields (name, theme, accent, …)  
✅ `19:02:10` …the logo entry carries its digest  
✅ `19:02:10` …and the removal is one entry  
✅ `19:02:10` …revisions 1 to 5  
✅ `19:02:10` …no entry carries the brand's name  
✅ `19:02:10` …nor the logo's bytes  
✅ `19:02:10` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `19:02:10` Cleaning up test resources...  
