# Lamaste E2E: 52 — Per-domain branding: two brands, a stock third (Three-VM)

> Started at `2026-10-27 07:11:52 UTC`


## Pre-flight

✅ `07:11:52` Onboarding is complete  
✅ `07:11:52` Agent test-agent is enrolled on the host  
✅ `07:11:52` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  

## Domains B and C active; the image fixtures

✅ `07:11:53` Domain lamaste-second.local added (201)  
✅ `07:11:53` …pending until activated  
✅ `07:11:53` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `07:11:53` …the one required record is auth.lamaste-second.local  
✅ `07:11:54` lamaste-second.local is active  
✅ `07:11:55` Domain lamaste-third.local added (201)  
✅ `07:11:55` …pending until activated  
✅ `07:11:55` DNS of lamaste-third.local: auth.lamaste-third.local resolves to the relay  
✅ `07:11:55` …the one required record is auth.lamaste-third.local  
✅ `07:11:56` lamaste-third.local is active  
✅ `07:11:57` Four image fixtures written on the host VM, each with a digest  
✅ `07:11:57` …all four distinct  
✅ `07:11:57` Authelia's asset directory holds the placeholder logo (/etc/authelia/assets/logo.png)  
✅ `07:11:57` nginx's mime.types names a type for .ico (image/x-icon)  

## Brand A (dark, logo, ICO favicon) and brand B (light, logo, PNG favicon); C stays stock

✅ `07:11:57` PUT /api/domains/test.lamaste.local/branding: Brand A, dark, #1d4ed8, support contact  
✅ `07:11:57` …created at revision 1, dark, no warning  
✅ `07:11:58` PUT …/branding/logo: logo A (base64 in JSON)  
✅ `07:11:58` …revision 2, a 48×48 PNG, no warning  
✅ `07:11:58` …the answer's digest is the fixture's  
✅ `07:11:59` PUT …/branding/favicon: favicon A, an ICO — revision 3, its digest, no warning  
✅ `07:11:59` PUT /api/domains/lamaste-second.local/branding: Brand B, light, #b91c1c, nothing else  
✅ `07:12:00` Logo B set — revision 2, the fixture's digest  
✅ `07:12:01` Favicon B set, a PNG — revision 3, the fixture's digest  
✅ `07:12:01` lamaste-third.local has no brand  
✅ `07:12:01` Both brands are rendered at their revision (renderedCurrent)  

## The sign-in pages: theme, logo switch, stylesheet — C is the stock page

✅ `07:12:01` auth.test.lamaste.local/: 200  
✅ `07:12:01` …data-theme="dark" (A's theme)  
✅ `07:12:01` …data-logooverride="true" (A serves a logo)  
✅ `07:12:01` …links /brand.css  
✅ `07:12:01` …Authelia's Content-Security-Policy is sent, style-src 'self' as Authelia writes it  
✅ `07:12:01` …no light theme left anywhere in the page  
✅ `07:12:01` auth.lamaste-second.local/: data-theme="light" (B's theme)  
✅ `07:12:01` …data-logooverride="true" (B serves a logo)  
✅ `07:12:01` …links /brand.css  
✅ `07:12:01` auth.lamaste-third.local/: 200  
✅ `07:12:01` …data-theme="light" (the stock theme)  
✅ `07:12:01` …data-logooverride="false" (the placeholder is never shown)  
✅ `07:12:01` …no stylesheet: exactly the stock page  
✅ `07:12:01` …the same CSP as a branded domain's  

## /brand.css: the accent, the hidden footer, the asset headers

✅ `07:12:01` auth.test.lamaste.local/brand.css: 200  
✅ `07:12:01` …text/css (by the extension)  
✅ `07:12:01` …X-Content-Type-Options: nosniff  
✅ `07:12:01` …Cache-Control: public, max-age=0, must-revalidate  
✅ `07:12:02` …--primary is A's accent  
✅ `07:12:02` …the "Powered by" footer link is hidden  
✅ `07:12:02` auth.lamaste-second.local/brand.css: --primary is B's accent  
✅ `07:12:02` auth.lamaste-third.local/brand.css: 404 (no brand, no stylesheet)  

## The logos and favicons: the fixtures' bytes; C gets Authelia's

✅ `07:12:02` auth.test.lamaste.local/static/media/logo.png: logo A's bytes, image/png  
✅ `07:12:02` auth.lamaste-second.local/static/media/logo.png: logo B's bytes  
✅ `07:12:02` auth.lamaste-third.local/static/media/logo.png: Authelia's placeholder (the asset directory's logo.png)  
✅ `07:12:02` auth.test.lamaste.local/favicon.ico: favicon A's bytes, image/x-icon  
✅ `07:12:02` auth.lamaste-second.local/favicon.ico: favicon B's PNG bytes under the .ico name, image/x-icon by the extension  
✅ `07:12:02` auth.lamaste-third.local/favicon.ico: 200, Authelia's own  
✅ `07:12:02` …not favicon A  
✅ `07:12:02` …not favicon B  

## The locale files: the brand name in place of {{authelia}}, in English and Turkish

✅ `07:12:02` auth.test.lamaste.local/locales/en/portal.json: "Login - {{authelia}}" → "Login - Brand A"  
✅ `07:12:02` …"Powered by {{authelia}}" → "Powered by Brand A"  
✅ `07:12:02` …no {{authelia}} left in any value  
✅ `07:12:03` auth.test.lamaste.local/locales/tr/portal.json: the Turkish title carries Brand A (Giriş - Brand A)  
✅ `07:12:03` …and no placeholder  
✅ `07:12:03` auth.lamaste-second.local/locales/en/portal.json says Brand B  
✅ `07:12:03` auth.lamaste-third.local/locales/en/portal.json is Authelia's own: the title still interpolates {{authelia}}  
✅ `07:12:03` …no brand of another domain  
✅ `07:12:03` auth.test.lamaste.local/locales/en/settings.json carries Brand A too  

## The invitation page: A's branded, C's the stock page, the same script

✅ `07:12:03` auth.test.lamaste.local/invite/x: 200  
✅ `07:12:03` …titled Brand A — Accept Invitation  
✅ `07:12:03` …the brand's name in the header  
✅ `07:12:03` …and its tagline  
✅ `07:12:03` …the logo from the same origin  
✅ `07:12:03` …the accent  
✅ `07:12:03` auth.lamaste-third.local/invite/x: 200  
✅ `07:12:03` …the stock page  
✅ `07:12:03` …no brand header  
✅ `07:12:03` Both pages carry a script of the same length  
✅ `07:12:03` …byte for byte the same script (the API calls are unchanged)  

## A member of A; a tunnel on each domain (B and C authenticated, A restricted)

✅ `07:12:04` User e2e52-a created, member of test.lamaste.local  
✅ `07:12:04` e2e52-a has a directory id  
✅ `07:12:04` Tunnel e2e52b.lamaste-second.local (authenticated), carried by test-agent  
✅ `07:12:05` Tunnel e2e52a.test.lamaste.local (restricted), carried by test-agent  
✅ `07:12:06` Tunnel e2e52c.lamaste-third.local (authenticated), carried by test-agent  
✅ `07:12:08` e2e52-a signed in at auth.lamaste-second.local (password, TOTP)  
✅ `07:12:32` e2e52-a signed in at auth.test.lamaste.local (password, TOTP)  
✅ `07:13:02` e2e52-a signed in at auth.lamaste-third.local (password, TOTP)  

## The domain refusal on B's tunnel carries brand B

✅ `07:13:03` e2e52-a (a member of A) on B's tunnel: 403  
✅ `07:13:03` …the domain refusal page  
✅ `07:13:03` …naming lamaste-second.local  
✅ `07:13:03` …never a redirect to a sign-in page (no login loop)  
✅ `07:13:03` …titled with Brand B  
✅ `07:13:03` …Brand B in the header  
✅ `07:13:03` …the logo from B's sign-in host  
✅ `07:13:03` …B's accent  
✅ `07:13:03` …no Help link (B names no support URL)  
✅ `07:13:03` …nothing of brand A  

## The access-request page on A's restricted tunnel carries brand A and its support contact

✅ `07:13:03` e2e52-a on A's restricted tunnel without a grant: 403  
✅ `07:13:03` …the access-request page  
✅ `07:13:03` …not the domain refusal  
✅ `07:13:03` …never a redirect to a sign-in page  
✅ `07:13:03` …titled with Brand A  
✅ `07:13:03` …Brand A in the header  
✅ `07:13:03` …its tagline  
✅ `07:13:03` …the logo from A's sign-in host  
✅ `07:13:03` …A's accent  
✅ `07:13:03` …the brand's support e-mail as the contact  
✅ `07:13:03` …and its support URL as the Help link  

## On C's tunnel the refusal is the stock page

✅ `07:13:03` e2e52-a on C's tunnel: 403  
✅ `07:13:03` …the domain refusal page  
✅ `07:13:03` …naming lamaste-third.local  
✅ `07:13:03` …never a redirect to a sign-in page (no login loop)  
✅ `07:13:03` …titled without a brand  
✅ `07:13:03` …no brand header  
✅ `07:13:03` …the pages' own accent  

## A's theme changed to oled: the page and its vhost follow

✅ `07:13:04` PUT …/branding with theme oled: revision 4, no warning  
✅ `07:13:04` auth.test.lamaste.local/ says data-theme="oled"  
✅ `07:13:04` The installed auth vhost of test.lamaste.local rewrites the theme to oled  
✅ `07:13:04` …and keeps the logo switch on  
✅ `07:13:04` nginx -t passes  

## A's logo removed: the logo switch off, the placeholder back

✅ `07:13:05` DELETE …/branding/logo: removed, revision 5, no warning  
✅ `07:13:05` auth.test.lamaste.local/ says data-logooverride="false"  
✅ `07:13:05` auth.test.lamaste.local/static/media/logo.png is Authelia's placeholder again  
✅ `07:13:05` …the stylesheet stays (the brand does)  

## B's brand removed: the stock page, its rendering gone

✅ `07:13:05` DELETE /api/domains/lamaste-second.local/branding: removed, no warning  
✅ `07:13:05` GET says lamaste-second.local has no brand  
✅ `07:13:05` auth.lamaste-second.local/ is the stock page: data-logooverride="false", no stylesheet  
✅ `07:13:06` …data-theme="light"  
✅ `07:13:06` auth.lamaste-second.local/brand.css: 404  
✅ `07:13:06` auth.lamaste-second.local/static/media/logo.png: the placeholder  
✅ `07:13:06` /var/www/lamaste/auth/lamaste-second.local is gone  
✅ `07:13:06` No rendering of lamaste-second.local is left under .renders/  
✅ `07:13:06` Exactly one rendering of test.lamaste.local serves (the previous ones removed)  

## The audit names fields and digests, never the name or the bytes

✅ `07:13:06` Five domain.branding.updated entries for test.lamaste.local: fields, logo, favicon, fields, logo removed  
✅ `07:13:06` …the field entries name the fields (name, theme, accent, …)  
✅ `07:13:06` …the logo entry carries its digest  
✅ `07:13:06` …and the removal is one entry  
✅ `07:13:06` …revisions 1 to 5  
✅ `07:13:06` …no entry carries the brand's name  
✅ `07:13:06` …nor the logo's bytes  
✅ `07:13:06` One domain.branding.removed entry for lamaste-second.local  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `140` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `140` |

ℹ️ `07:13:06` Cleaning up test resources...  
